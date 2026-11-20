#pragma once

// ESPHome auto-includes headers found in the shared directory in both entries.
// Only the touchscreen entry enables LVGL and provides the SD IDF dependencies.
#ifdef USE_LVGL

// Display-only SD diagnostics. The dedicated SPI bus has no other devices;
// CH422G EXIO4 holds SD_CS low, matching Waveshare's SD example (SS = -1).
#include "driver/spi_master.h"
#include "driver/sdspi_host.h"
#include "esp_vfs_fat.h"
#include "sdmmc_cmd.h"
#include "esp_random.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include "freertos/queue.h"
#include "minute_history.h"
#include "event_history.h"
#include "zip_stream.h"
#include "esphome/components/web_server_base/web_server_base.h"
#include <memory>
#include <new>
#include "sd_web_budget.h"
#include <atomic>
#include <cerrno>
#include <cstdio>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <dirent.h>
#include <fcntl.h>
#include <string>
#include <sys/stat.h>
#include <unistd.h>

namespace paw {
inline constexpr char SD_EVENT_HEADER[]="utc_time,code\n";
inline constexpr char SD_CSV_HEADER_LEGACY[]="utc_start,local_start,coverage_s,quality,soc_pct,volts,amps,watts,charged_wh,discharged_wh\n";
inline constexpr char SD_CSV_HEADER[]="utc_start,local_start,coverage_s,quality,soc_pct,volts,amps,watts,charged_wh,discharged_wh,temp_c\n";
inline std::string sd_filesystem_error(int error) {
  return " (errno="+std::to_string(error)+": "+std::string(std::strerror(error))+")";
}
inline std::string sd_json_string(const std::string &text) {
  std::string out="\"";
  for(unsigned char c:text) {
    if(c=='"' || c=='\\') {out+='\\';out+=char(c);}
    else if(c<32) {char b[7];std::snprintf(b,sizeof(b),"\\u%04x",unsigned(c));out+=b;}
    else out+=char(c);
  }
  return out+'"';
}

class SdDiagnostics {
 public:
  void setup() {
    if(worker_)return;
    mutex_=xSemaphoreCreateMutex();
    if(!mutex_) {startup_error_="SD diagnostics: insufficient memory";return;}
    records_=xQueueCreate(4,sizeof(MinuteRecord));
    if(!records_){startup_error_="SD minute queue could not start";vSemaphoreDelete(mutex_);mutex_=nullptr;return;}
    events_=xQueueCreate(16,sizeof(EventRecord));
    if(!events_){startup_error_="SD event queue could not start";vQueueDelete(records_);records_=nullptr;vSemaphoreDelete(mutex_);mutex_=nullptr;return;}
    if(xTaskCreate(task_entry,"paw_sd",6144,this,1,&worker_)!=pdPASS) {
      worker_=nullptr;vQueueDelete(events_);events_=nullptr;vQueueDelete(records_);records_=nullptr;vSemaphoreDelete(mutex_);mutex_=nullptr;
      startup_error_="SD diagnostics worker could not start";return;
    }
    request(false);
  }
  void request(bool write_test) {
    enqueue(write_test?2:1);
  }
  bool request_erase(const std::string &confirmation) {
    return confirmation=="ERASE" && enqueue(3);
  }
  void record(const MinuteRecord &record) {
    if(!worker_ || xQueueSend(records_,&record,0)!=pdTRUE){++dropped_;return;}
    xTaskNotifyGive(worker_);
  }
  void event(const EventRecord &event) {
    if(!worker_ || xQueueSend(events_,&event,0)!=pdTRUE){++events_dropped_;return;}
    xTaskNotifyGive(worker_);
  }
  bool request_export(const std::string &input) {
    const bool event_file=input.rfind("E:",0)==0;
    const std::string request=event_file?input.substr(2):input;
    const size_t bar=request.find('|',11);
    if(request.size()>64 || request.size()<14 || request[10]!='|' || bar==std::string::npos)return false;
    const auto date=request.substr(0,10),offset=request.substr(11,bar-11),token=request.substr(bar+1);
    for(unsigned i=0;i<10;++i)if(i==4 || i==7){if(date[i]!='-')return false;}else if(date[i]<'0'||date[i]>'9')return false;
    if(offset.empty() || offset.size()>7 || offset.find_first_not_of("0123456789")!=std::string::npos ||
       token.empty() || token.size()>32 || token.find_first_not_of("0123456789abcdef")!=std::string::npos)return false;
    const unsigned long position=std::strtoul(offset.c_str(),nullptr,10);
    if(position>1048576 || !worker_ || busy_.exchange(true))return false;
    export_date_=date;export_offset_=position;export_token_=token;export_events_=event_file;
    operation_.store(5);xTaskNotifyGive(worker_);return true;
  }
  bool request_backup(httpd_req_t *request,const std::string &from,const std::string &to){
    if(!backup_range_valid(from,to)){httpd_resp_send_err(request,HTTPD_400_BAD_REQUEST,"Choose up to 31 valid dates.");return false;}
    if(!worker_ || busy_.exchange(true)){httpd_resp_set_status(request,"503 Service Unavailable");httpd_resp_set_type(request,"text/plain");httpd_resp_send(request,"SD worker busy; retry shortly.",HTTPD_RESP_USE_STRLEN);return false;}
    httpd_req_t *copy=nullptr;
    if(httpd_req_async_handler_begin(request,&copy)!=ESP_OK){busy_.store(false);httpd_resp_set_status(request,"503 Service Unavailable");httpd_resp_set_type(request,"text/plain");httpd_resp_send(request,"Cannot start asynchronous download.",HTTPD_RESP_USE_STRLEN);return false;}
    backup_request_=copy;backup_from_=from;backup_to_=to;backup_cancel_.store(false);
    operation_.store(7);xTaskNotifyGive(worker_);return true;
  }
  void cancel_backup(){backup_cancel_.store(true);}
  uint32_t completed_revision()const{return completed_revision_.load();}
  std::string json() {
    if(!mutex_)return "{\"busy\":false,\"mounted\":false,\"message\":"+sd_json_string(startup_error_)+",\"files\":[]}";
    xSemaphoreTake(mutex_,portMAX_DELAY);
    std::string result=snapshot_;
    xSemaphoreGive(mutex_);
    // The worker owns filesystem state; readers only see completed snapshots.
    return "{\"busy\":"+std::string(busy_.load()?"true":"false")+","+result+"}";
  }
 private:
  bool enqueue(int operation) {
    if(!worker_ || busy_.exchange(true))return false;
    operation_.store(operation);xTaskNotifyGive(worker_);return true;
  }
  static void task_entry(void *arg) {static_cast<SdDiagnostics *>(arg)->run();}
  void run() {
    for(;;) {
      ulTaskNotifyTake(pdTRUE,portMAX_DELAY);
      int operation=operation_.exchange(0);
      MinuteRecord record{};EventRecord event{};
      if(!operation) {
        bool expected=false;
        if(!busy_.compare_exchange_strong(expected,true))continue;
        if(xQueueReceive(events_,&event,0)==pdTRUE)operation=6;
        else if(xQueueReceive(records_,&record,0)==pdTRUE)operation=4;
        else {busy_.store(false);continue;}
      }
      std::string message;
      export_result_="null";
      if(mount(message)) {
        if(operation==7)message=stream_backup();
        else if(operation==5){export_result_=read_export();message="CSV download request processed";}
        else if(operation==6){message=append_event(event);event_logger_status_=message;}
        else if(operation==4) {
          message=append_record(record);
          logger_status_=message;
        }
        else if(operation==3){xQueueReset(records_);xQueueReset(events_);message=erase_files();logger_status_="Recording resumes with the next queued minute";}
        else if(operation==2)message=write_read_test();
        else message="Card mounted";
      }
      else if(operation==4){++dropped_;logger_status_=message;}
      else if(operation==6){++events_dropped_;event_logger_status_=message;}
      if(operation==7 && backup_request_){
        httpd_resp_send_err(backup_request_,HTTPD_500_INTERNAL_SERVER_ERROR,message.c_str());
        httpd_req_async_handler_complete(backup_request_);backup_request_=nullptr;
      }
      std::string files="[]";bool truncated=false;
      if(card_)files=list_root(message,truncated);
      const uint64_t megabytes=card_?uint64_t(card_->csd.capacity)*card_->csd.sector_size/(1024*1024):0;
      uint64_t total=0,free=0;
      const bool space_known=card_ && esp_vfs_fat_info("/sdcard",&total,&free)==ESP_OK;
      std::string prefix="\"zip_backup\":true,\"mounted\":"+std::string(card_?"true":"false")+
        ",\"revision\":"+std::to_string(++revision_)+
        ",\"total_bytes\":"+(space_known?std::to_string(total):"null")+
        ",\"free_bytes\":"+(space_known?std::to_string(free):"null")+
        ",\"logging\":"+sd_json_string(logger_status_)+
        ",\"rows_written\":"+std::to_string(rows_written_)+
        ",\"dropped_minutes\":"+std::to_string(dropped_.load())+
        ",\"event_logging\":"+sd_json_string(event_logger_status_)+
        ",\"event_rows\":"+std::to_string(events_written_)+
        ",\"event_dropped\":"+std::to_string(events_dropped_.load())+
        ",\"export\":"+export_result_+
        ",\"capacity_mb\":"+std::to_string(megabytes)+",\"message\":"+sd_json_string(message);
      auto assemble=[&](){return prefix+",\"truncated\":"+(truncated?"true":"false")+",\"files\":"+files;};
      std::string next=assemble();
      auto fits=[&](){return sd_web_snapshot_fits("{\"busy\":false,"+next+"}");};
      if(!fits()){files="[]";truncated=true;next=assemble();}
      if(!fits()) {
        // Keep the download response usable even if ancillary diagnostics grow.
        next="\"mounted\":"+std::string(card_?"true":"false")+
          ",\"revision\":"+std::to_string(revision_)+",\"export\":"+export_result_+
          ",\"message\":\"Diagnostics shortened to fit web response; refresh file list after download\",\"truncated\":true,\"files\":[]";
      }
      xSemaphoreTake(mutex_,portMAX_DELAY);snapshot_.swap(next);xSemaphoreGive(mutex_);
      busy_.store(false);
      completed_revision_.store(revision_);
      if(uxQueueMessagesWaiting(records_) || uxQueueMessagesWaiting(events_) || operation_.load())xTaskNotifyGive(worker_);
    }
  }
  bool mount(std::string &message) {
    if(card_)return true;
    spi_bus_config_t bus{};
    bus.mosi_io_num=11;bus.miso_io_num=13;bus.sclk_io_num=12;
    bus.quadwp_io_num=-1;bus.quadhd_io_num=-1;bus.max_transfer_sz=4096;
    esp_err_t err=spi_bus_initialize(SPI2_HOST,&bus,SPI_DMA_CH_AUTO);
    if(err!=ESP_OK){message="SD SPI initialization failed: "+std::string(esp_err_to_name(err));return false;}
    sdmmc_host_t host=SDSPI_HOST_DEFAULT();
    host.slot=SPI2_HOST;host.max_freq_khz=4000;host.command_timeout_ms=1000;
    sdspi_device_config_t slot=SDSPI_DEVICE_CONFIG_DEFAULT();
    slot.host_id=SPI2_HOST;slot.gpio_cs=GPIO_NUM_NC;
    esp_vfs_fat_mount_config_t config{};
    config.format_if_mount_failed=false;config.max_files=3;config.allocation_unit_size=16*1024;
    err=esp_vfs_fat_sdspi_mount("/sdcard",&host,&slot,&config,&card_);
    if(err!=ESP_OK) {
      card_=nullptr;spi_bus_free(SPI2_HOST);
      message="SD mount failed: "+std::string(esp_err_to_name(err))+". Check card seating and FAT32 format; no formatting was attempted.";
      return false;
    }
    return true;
  }
  std::string list_root(std::string &message,bool &truncated) {
    DIR *dir=opendir("/sdcard");
    if(!dir){const int error=errno;message+="; root directory could not be read"+sd_filesystem_error(error);return "[]";}
    std::string entries;unsigned count=0;
    errno=0;
    while(auto *entry=readdir(dir)) {
      const std::string name=entry->d_name;
      if(name=="." || name=="..")continue;
      if(count>=32){truncated=true;break;}
      struct stat info{};
      const std::string path="/sdcard/"+name;
      const bool known=stat(path.c_str(),&info)==0;
      const auto item="{\"name\":"+sd_json_string(name)+",\"directory\":"+
        (known && S_ISDIR(info.st_mode)?"true":"false")+",\"bytes\":"+
        (known?std::to_string(uint64_t(info.st_size)):"null")+"}";
      if(sd_web_string_size(entries)+sd_web_string_size(item)>1024){truncated=true;break;}
      if(count++)entries+=',';
      entries+=item;
      errno=0;
    }
    const int read_error=errno;
    if(read_error)message+="; directory read incomplete"+sd_filesystem_error(read_error);
    else message+="; root directory listed";
    if(closedir(dir)!=0){const int error=errno;message+="; directory close failed"+sd_filesystem_error(error);}
    return '['+entries+']';
  }
  std::string write_read_test() {
    char path[80];int fd=-1;
    for(unsigned attempt=0;attempt<4;++attempt) {
      std::snprintf(path,sizeof(path),"/sdcard/PAWTEST-%08lx.TXT",static_cast<unsigned long>(esp_random()));
      fd=open(path,O_WRONLY|O_CREAT|O_EXCL,0600);
      if(fd>=0 || errno!=EEXIST)break;
    }
    if(fd<0)return "SD write test failed: could not create a new test file; existing files were not overwritten";
    const char payload[]="Paw Power SD write/read verification\n";
    const ssize_t written=write(fd,payload,sizeof(payload)-1);
    const bool synced=fsync(fd)==0;
    const bool closed=close(fd)==0;
    if(written!=ssize_t(sizeof(payload)-1) || !synced || !closed)
      return "SD write/flush test failed; diagnostic file retained";
    fd=open(path,O_RDONLY);
    if(fd<0)return "SD test read failed; diagnostic file retained";
    char readback[sizeof(payload)]{};
    const ssize_t received=read(fd,readback,sizeof(readback));
    const bool read_closed=close(fd)==0;
    if(received!=ssize_t(sizeof(payload)-1) || !read_closed || std::memcmp(payload,readback,sizeof(payload)-1)!=0)
      return "SD read-back comparison failed; diagnostic file retained";
    if(unlink(path)!=0){const int error=errno;return "SD write/read verified, but test file cleanup failed"+sd_filesystem_error(error);}
    return "PASS: created, wrote, flushed, reopened and verified a test file, then removed that test file";
  }
  bool service_backup_recordings(){
    MinuteRecord minute{};EventRecord event{};
    for(unsigned i=0;i<2 && xQueueReceive(records_,&minute,0)==pdTRUE;++i)logger_status_=append_record(minute);
    for(unsigned i=0;i<8 && xQueueReceive(events_,&event,0)==pdTRUE;++i)append_event(event);
    vTaskDelay(1);
    return !backup_cancel_.load();
  }
  std::string stream_backup(){
    struct File{std::string name;uint32_t size;};
    auto *request=backup_request_;
    std::vector<File> files;std::vector<std::string> missing;uint64_t total=0;
    std::string error;
    for(auto date=backup_from_;date<=backup_to_;date=backup_next_date(date)){
      for(bool event:{false,true}){
        const std::string name=std::string(event?"PawPower-Events-":"PawPower-")+date+".csv";
        struct stat st{};const auto path="/sdcard/"+name;
        if(stat(path.c_str(),&st)!=0){if(errno==ENOENT)missing.push_back(name);else error="Cannot inspect SD file";continue;}
        if(!S_ISREG(st.st_mode) || st.st_size<0 || st.st_size>1048576){error="History file exceeds 1 MiB or is not a regular file";continue;}
        total+=st.st_size;files.push_back({name,uint32_t(st.st_size)});
      }
      if(!service_backup_recordings()){error="Backup cancelled";break;}
    }
    if(total>32*1048576)error="Selected history exceeds 32 MiB; choose fewer days";
    if(files.empty() && error.empty())error="No history files for this date range";
    if(!error.empty()){
      httpd_resp_send_err(request,files.empty()?HTTPD_404_NOT_FOUND:HTTPD_500_INTERNAL_SERVER_ERROR,error.c_str());
      httpd_req_async_handler_complete(request);backup_request_=nullptr;return error;
    }
    auto zip=std::unique_ptr<ZipStream>(new(std::nothrow) ZipStream([&](const uint8_t *bytes,size_t length){
      return !backup_cancel_.load() && httpd_resp_send_chunk(request,reinterpret_cast<const char*>(bytes),length)==ESP_OK;
    }));
    if(!zip){httpd_resp_send_err(request,HTTPD_500_INTERNAL_SERVER_ERROR,"Insufficient memory for ZIP compressor");httpd_req_async_handler_complete(request);backup_request_=nullptr;return "ZIP memory allocation failed";}
    const auto filename="attachment; filename=\"PawPower-History-"+backup_from_+"-to-"+backup_to_+".zip\"";
    httpd_resp_set_type(request,"application/zip");httpd_resp_set_hdr(request,"Content-Disposition",filename.c_str());
    httpd_resp_set_hdr(request,"Cache-Control","no-store");
    bool ok=true;
    for(const auto &file:files){
      const auto path="/sdcard/"+file.name;int fd=open(path.c_str(),O_RDONLY);
      if(fd<0){ok=false;break;}
      ok=zip->add(file.name,file.size,[&](uint8_t *data,size_t size){
        size_t got=0;while(got<size){const auto n=read(fd,data+got,size-got);if(n<=0)return -1;got+=n;}return int(got);
      },[&](){return service_backup_recordings();});
      if(close(fd)!=0)ok=false;
      if(!ok)break;
    }
    if(ok){
      std::string report="{\"from\":"+sd_json_string(backup_from_)+",\"to\":"+sd_json_string(backup_to_)+
        ",\"compression\":\"DEFLATE\",\"uncompressed_bytes\":"+std::to_string(total)+",\"missing\":[";
      for(size_t i=0;i<missing.size();++i){if(i)report+=',';report+=sd_json_string(missing[i]);}
      report+="],\"note\":\"Each file is a snapshot at backup start; today's files may be partial. Raw recorded CSVs only.\"}";
      size_t at=0;ok=zip->add("backup-report.json",report.size(),[&](uint8_t *data,size_t size){std::memcpy(data,report.data()+at,size);at+=size;return int(size);},[&](){return service_backup_recordings();}) && zip->finish();
    }
    if(ok)ok=httpd_resp_send_chunk(request,nullptr,0)==ESP_OK;
    // Do not terminate a failed ZIP as a successful HTTP body: native download
    // managers must see failure, never a deceptively complete corrupt archive.
    if(!ok)httpd_sess_trigger_close(request->handle,httpd_req_to_sockfd(request));
    httpd_req_async_handler_complete(request);backup_request_=nullptr;
    return ok?"Compressed ZIP backup complete ("+std::to_string(files.size())+" files; "+std::to_string(missing.size())+" unavailable)":
      backup_cancel_.load()?"ZIP backup cancelled; discard incomplete download":"ZIP stream failed; discard incomplete download";
  }
  std::string append_record(const MinuteRecord &r) {
    uint64_t total=0,free=0;
    if(esp_vfs_fat_info("/sdcard",&total,&free)!=ESP_OK || free<65536) {
      ++dropped_;return "Recording paused: card full or free space unavailable; free space then retry next minute";
    }
    const time_t stamp=static_cast<time_t>(r.minute*60);
    tm local{},utc{};localtime_r(&stamp,&local);gmtime_r(&stamp,&utc);
    char path[80],when[32],local_when[32],line[512];
    std::strftime(path,sizeof(path),"/sdcard/PawPower-%Y-%m-%d.csv",&local);
    std::strftime(when,sizeof(when),"%Y-%m-%dT%H:%M:%SZ",&utc);
    std::strftime(local_when,sizeof(local_when),"%Y-%m-%dT%H:%M:%S",&local);
    const char *quality=r.seconds<=0?"missing":r.clock_gap?"clock_gap":r.startup?"startup_partial":r.seconds<59.5?"partial":"complete";
    if(r.seconds>0)std::snprintf(line,sizeof(line),"%s,%s,%.3f,%s,%.3f,%.3f,%.3f,%.3f,%.6f,%.6f\n",
      when,local_when,r.seconds,quality,r.soc_seconds/r.seconds,r.volt_seconds/r.seconds,
      r.amp_seconds/r.seconds,r.watt_seconds/r.seconds,r.charged_wh,r.discharged_wh);
    else std::snprintf(line,sizeof(line),"%s,%s,0,missing,,,,,,\n",when,local_when);
    const char *header=SD_CSV_HEADER;
    size_t header_length=std::strlen(header);
    bool with_temperature=true;
    int fd=open(path,O_RDWR|O_CREAT,0600);
    if(fd<0){const int e=errno;++dropped_;return "CSV open failed"+sd_filesystem_error(e);}
    std::string error;
    struct stat info{};
    if(fstat(fd,&info)!=0)error="CSV stat failed";
    if(error.empty() && info.st_size>0) {
      char existing[sizeof(SD_CSV_HEADER)]{};
      const ssize_t count=read(fd,existing,sizeof(existing)-1);
      const size_t legacy_length=std::strlen(SD_CSV_HEADER_LEGACY);
      if(count>=ssize_t(header_length) && std::memcmp(header,existing,header_length)==0) {
        // Current schema.
      } else if(count>=ssize_t(legacy_length) &&
                std::memcmp(SD_CSV_HEADER_LEGACY,existing,legacy_length)==0) {
        header=SD_CSV_HEADER_LEGACY;header_length=legacy_length;with_temperature=false;
      } else if(count>0 && count==info.st_size && count<ssize_t(header_length) &&
                std::memcmp(header,existing,count)==0 && ftruncate(fd,0)==0) {
        info.st_size=0;
      } else error="CSV header mismatch; existing file preserved";
      // A lost-power append may leave an incomplete final row. Preserve every
      // complete row and discard only the unterminated tail before appending.
      if(error.empty() && info.st_size>0) {
        char tail[1024];const off_t start=info.st_size>off_t(sizeof(tail))?info.st_size-sizeof(tail):0;
        if(lseek(fd,start,SEEK_SET)<0)error="CSV seek failed";
        else {
          const ssize_t n=read(fd,tail,sizeof(tail));
          if(n<=0)error="CSV tail read failed";
          else if(tail[n-1]!='\n') {
            ssize_t last=n-1;while(last>=0 && tail[last]!='\n')--last;
            if(last<0 || ftruncate(fd,start+last+1)!=0)error="CSV incomplete-tail repair failed";
          }
        }
      }
    }
    if(error.empty() && lseek(fd,0,SEEK_END)<0)error="CSV append seek failed";
    if(error.empty() && info.st_size==0 && write(fd,header,header_length)!=ssize_t(header_length))error="CSV header write failed";
    if(with_temperature) {
      const size_t end=std::strlen(line)-1;
      if(r.seconds>0 && r.temp_coverage>=r.seconds-0.001)
        std::snprintf(line+end,sizeof(line)-end,",%.3f\n",r.temp_seconds/r.temp_coverage);
      else std::snprintf(line+end,sizeof(line)-end,",\n");
    }
    const size_t length=std::strlen(line);
    if(error.empty() && write(fd,line,length)!=ssize_t(length))error="CSV row write failed";
    if(error.empty() && fsync(fd)!=0)error="CSV flush failed";
    if(close(fd)!=0 && error.empty())error="CSV close failed";
    if(!error.empty()){++dropped_;return error+"; minute not confirmed saved";}
    ++rows_written_;
    return std::string("Saved ")+when+" ("+quality+") to "+(path+8);
  }
  std::string append_event(const EventRecord &r) {
    uint64_t total=0,free=0;
    if(esp_vfs_fat_info("/sdcard",&total,&free)!=ESP_OK || free<65536) {
      ++events_dropped_;return "Event not saved: card full or free space unavailable";
    }
    const time_t stamp=static_cast<time_t>(r.epoch);
    tm local{},utc{};localtime_r(&stamp,&local);gmtime_r(&stamp,&utc);
    char path[80],when[32],line[80];
    std::strftime(path,sizeof(path),"/sdcard/PawPower-Events-%Y-%m-%d.csv",&local);
    std::strftime(when,sizeof(when),"%Y-%m-%dT%H:%M:%SZ",&utc);
    std::snprintf(line,sizeof(line),"%s,%u\n",when,unsigned(r.code));
    int fd=open(path,O_RDWR|O_CREAT,0600);
    if(fd<0){const int error=errno;++events_dropped_;return "Event file open failed"+sd_filesystem_error(error);}
    std::string error;struct stat info{};
    if(fstat(fd,&info)!=0)error="Event file stat failed";
    if(error.empty() && info.st_size>1048400)error="Daily event log reached download size limit";
    if(error.empty() && info.st_size>0) {
      char header[sizeof(SD_EVENT_HEADER)]{};
      const auto count=read(fd,header,sizeof(header)-1);
      if(count!=ssize_t(sizeof(header)-1) || std::memcmp(header,SD_EVENT_HEADER,sizeof(header)-1)!=0) {
        if(count>0 && count==info.st_size && count<ssize_t(sizeof(header)-1) &&
           std::memcmp(header,SD_EVENT_HEADER,count)==0 && ftruncate(fd,0)==0)info.st_size=0;
        else error="Event header mismatch; existing file preserved";
      }
      if(error.empty() && info.st_size>0) {
        char tail[128];const off_t from=info.st_size>off_t(sizeof(tail))?info.st_size-sizeof(tail):0;
        if(lseek(fd,from,SEEK_SET)<0)error="Event seek failed";
        else {
          const auto n=read(fd,tail,sizeof(tail));
          if(n<=0)error="Event tail read failed";
          else if(tail[n-1]!='\n') {
            ssize_t last=n-1;while(last>=0 && tail[last]!='\n')--last;
            if(last<0 || ftruncate(fd,from+last+1)!=0)error="Event tail repair failed";
          }
        }
      }
    }
    if(error.empty() && lseek(fd,0,SEEK_END)<0)error="Event append seek failed";
    if(error.empty() && info.st_size==0 && write(fd,SD_EVENT_HEADER,sizeof(SD_EVENT_HEADER)-1)!=ssize_t(sizeof(SD_EVENT_HEADER)-1))error="Event header write failed";
    const size_t length=std::strlen(line);
    if(error.empty() && write(fd,line,length)!=ssize_t(length))error="Event row write failed";
    if(error.empty() && fsync(fd)!=0)error="Event flush failed";
    if(close(fd)!=0 && error.empty())error="Event close failed";
    if(!error.empty()){++events_dropped_;return error;}
    ++events_written_;return "Event saved";
  }
  std::string read_export() {
    const std::string path=std::string(export_events_?"/sdcard/PawPower-Events-":"/sdcard/PawPower-")+export_date_+".csv";
    std::string data,error;bool missing=false;
    uint64_t size=0;int fd=open(path.c_str(),O_RDONLY);
    if(fd<0) {
      const int open_error=errno;
      if(export_events_ && open_error==ENOENT) {
        // Quiet days need not have an event file. Return an explicitly marked,
        // header-only result without creating a file or inventing any events.
        missing=true;size=sizeof(SD_EVENT_HEADER)-1;
        if(export_offset_>size)error="CSV offset exceeds empty event log";
        else data=std::string(SD_EVENT_HEADER).substr(export_offset_,SD_EXPORT_CHUNK_BYTES);
      }else error=std::string(export_events_?"Event CSV open failed":"Daily CSV not available")+
        sd_filesystem_error(open_error);
    }
    else {
      struct stat info{};char header[sizeof(SD_CSV_HEADER)]{};
      if(fstat(fd,&info)!=0 || info.st_size<0 || info.st_size>1048576)error="CSV size unavailable or exceeds 1 MiB download limit";
      else {
        size=info.st_size;
        const ssize_t header_bytes=read(fd,header,sizeof(header)-1);
        const size_t legacy_length=std::strlen(SD_CSV_HEADER_LEGACY);
        const bool valid_header=export_events_ ?
          (header_bytes>=ssize_t(sizeof(SD_EVENT_HEADER)-1) && std::memcmp(header,SD_EVENT_HEADER,sizeof(SD_EVENT_HEADER)-1)==0) :
          ((header_bytes>=ssize_t(sizeof(SD_CSV_HEADER)-1) && std::memcmp(header,SD_CSV_HEADER,sizeof(SD_CSV_HEADER)-1)==0) ||
           (header_bytes>=ssize_t(legacy_length) && std::memcmp(header,SD_CSV_HEADER_LEGACY,legacy_length)==0));
        if(!valid_header)error="Not a Paw Power history CSV";
        else if(export_offset_>size || lseek(fd,export_offset_,SEEK_SET)<0)error="CSV changed or seek failed";
        else {
          data.resize(SD_EXPORT_CHUNK_BYTES);
          const ssize_t n=read(fd,&data[0],data.size());
          if(n<0){data.clear();error="CSV read failed";}else data.resize(n);
        }
      }
      if(close(fd)!=0 && error.empty())error="CSV close failed";
    }
    // Account for both CSV escaping and the outer text-sensor JSON escaping.
    // A file with unusually many control characters still makes progress.
    while(sd_web_string_size(sd_json_string(data))>1400)data.resize(data.size()/2);
    return "{\"token\":"+sd_json_string(export_token_)+",\"date\":"+sd_json_string(export_date_)+
      ",\"offset\":"+std::to_string(export_offset_)+",\"size\":"+std::to_string(size)+
      ",\"missing\":"+(missing?"true":"false")+
      ",\"data\":"+sd_json_string(data)+",\"error\":"+sd_json_string(error)+"}";
  }
  // Only the SD worker enters here. It also owns all test/list operations, so
  // erase cannot race any other SD operation. Never remove the mount root.
  bool erase_directory(const std::string &path,unsigned depth,unsigned &files,unsigned &folders,std::string &error) {
    if((path!="/sdcard" && path.compare(0,8,"/sdcard/")!=0) || depth>8 || path.size()>768) {
      error="SD directory depth/path limit reached";return false;
    }
    DIR *dir=opendir(path.c_str());
    if(!dir){const int e=errno;error="Cannot open SD folder"+sd_filesystem_error(e);return false;}
    bool ok=true;
    for(;;) {
      errno=0;
      auto *entry=readdir(dir);
      if(!entry){if(errno){const int e=errno;error="SD folder read failed"+sd_filesystem_error(e);ok=false;}break;}
      const std::string name=entry->d_name;
      if(name=="." || name=="..")continue;
      if(name.find('/')!=std::string::npos || name.find('\\')!=std::string::npos) {
        error="Invalid SD entry name; erase stopped";ok=false;break;
      }
      const std::string child=path+'/'+name;
      if(child.size()>768){error="SD path limit reached";ok=false;break;}
      struct stat info{};
      if(stat(child.c_str(),&info)!=0){const int e=errno;error="Cannot inspect SD entry"+sd_filesystem_error(e);ok=false;break;}
      if(S_ISDIR(info.st_mode)) {
        if(!erase_directory(child,depth+1,files,folders,error)){ok=false;break;}
        if(rmdir(child.c_str())!=0){const int e=errno;error="Cannot remove SD folder"+sd_filesystem_error(e);ok=false;break;}
        ++folders;
      } else if(S_ISREG(info.st_mode)) {
        if(unlink(child.c_str())!=0){const int e=errno;error="Cannot remove SD file"+sd_filesystem_error(e);ok=false;break;}
        ++files;
      } else {error="Unsupported SD entry type; erase stopped";ok=false;break;}
      // Large log directories must not monopolize CPU time.
      vTaskDelay(1);
    }
    if(closedir(dir)!=0 && ok){const int e=errno;error="SD folder close failed"+sd_filesystem_error(e);ok=false;}
    return ok;
  }
  std::string erase_files() {
    unsigned files=0,folders=0;std::string error;
    const bool ok=erase_directory("/sdcard",0,files,folders,error);
    return std::string(ok?"ERASE COMPLETE: ":"ERASE STOPPED: ")+std::to_string(files)+
      " files and "+std::to_string(folders)+" folders removed"+(ok?"":("; "+error));
  }
  TaskHandle_t worker_=nullptr;
  httpd_req_t *backup_request_=nullptr;
  std::string backup_from_,backup_to_;
  std::atomic<bool> backup_cancel_{false};
  SemaphoreHandle_t mutex_=nullptr;
  QueueHandle_t records_=nullptr;
  sdmmc_card_t *card_=nullptr;
  std::atomic<bool> busy_{false};
  std::atomic<int> operation_{0};
  uint32_t revision_=0;
  uint32_t rows_written_=0;
  std::atomic<uint32_t> dropped_{0};
  std::atomic<uint32_t> completed_revision_{0};
  std::string logger_status_="Waiting for the first completed minute and a valid clock";
  QueueHandle_t events_=nullptr;
  std::atomic<uint32_t> events_dropped_{0};
  uint32_t events_written_=0;
  std::string event_logger_status_="Waiting for the first dated event";
  bool export_events_=false;
  std::string export_date_,export_token_,export_result_="null";
  uint32_t export_offset_=0;
  std::string startup_error_="SD diagnostics not initialized";
  std::string snapshot_="\"mounted\":false,\"message\":\"Checking card...\",\"files\":[]";
};
inline SdDiagnostics &sd_diagnostics(){static SdDiagnostics instance;return instance;}
class HistoryZipHandler : public AsyncWebHandler {
 public:
  bool canHandle(AsyncWebServerRequest *request)const override{
    char url[AsyncWebServerRequest::URL_BUF_SIZE];const auto path=request->url_to(url);
    return (request->method()==HTTP_GET && path=="/paw/history.zip") ||
      (request->method()==HTTP_POST && path=="/paw/history-cancel");
  }
  void handleRequest(AsyncWebServerRequest *request)override{
    if(request->method()==HTTP_POST){sd_diagnostics().cancel_backup();request->send(200,"text/plain","Cancellation requested");return;}
    const auto *from=request->getParam("from"),*to=request->getParam("to");
    if(!from || !to){request->send(400,"text/plain","Missing from/to dates");return;}
    sd_diagnostics().request_backup(static_cast<httpd_req_t*>(*request),from->value(),to->value());
  }
};
inline void setup_history_zip(){
  static bool registered=false;
  if(!registered && esphome::web_server_base::global_web_server_base){
    esphome::web_server_base::global_web_server_base->add_handler(new HistoryZipHandler());registered=true;
  }
}
} // namespace paw
#endif  // USE_LVGL
