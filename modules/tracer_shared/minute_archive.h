#pragma once
#include "minute_archive_model.h"
#include <atomic>
#include <algorithm>
#include <vector>
#include "nvs.h"
#include "esp_partition.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "esphome/components/json/json_util.h"
namespace pawtracer {
class MinuteArchive {
 public:
  enum State { STARTING, RECORDING, SMALL_PARTITION, OPEN_FAILED, READ_FAILED, SAVE_FAILED, MEMORY_FAILED, CLOCK_ROLLBACK };
  void setup(){
    if(task_ || attempted_)return;attempted_=true;
    samples_=xQueueCreate(8,sizeof(Sample));requests_=xQueueCreate(1,sizeof(Request));results_=xQueueCreate(1,sizeof(Reply));
    if(!samples_||!requests_||!results_){cleanup();state_=MEMORY_FAILED;return;}
    if(xTaskCreate(run,"tracer_logs",6144,this,1,&task_)!=pdPASS){task_=nullptr;cleanup();state_=MEMORY_FAILED;}
  }
  void clock(bool valid){clock_valid_=valid;}
  int state_code()const{return state_.load();}
  void submit(const ArchivedReading &row,uint32_t oldest){
    if(!task_ || !supported_.load() || !clock_valid_.load()){++dropped_;return;}
    const Sample job{row,oldest};
    if(xQueueSend(samples_,&job,0)!=pdTRUE)++dropped_;else xTaskNotifyGive(task_);
  }
  // Native text command uses date|minute_offset|hex_token. Bounds come from the unit's clock.
  void request(const std::string &text,uint32_t now,uint32_t date,uint32_t from,uint32_t until,uint32_t oldest){
    if(!task_)return;
    const auto a=text.find('|'),b=a==std::string::npos?a:text.find('|',a+1);
    if(a!=10 || b==std::string::npos || b-a<2 || b-a>5 || text.size()-b-1>24)return;
    Request r{};r.date=date;r.from=from;r.until=until;r.oldest=oldest;r.now=now;
    const auto token=text.substr(b+1);if(token.empty())return;
    for(char c:token)if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')))return;
    std::memcpy(r.token,token.c_str(),token.size()+1);
    for(size_t i=a+1;i<b;++i){if(text[i]<'0'||text[i]>'9')return;r.offset=r.offset*10+text[i]-'0';}
    if(supported_.load()){xQueueOverwrite(requests_,&r);xTaskNotifyGive(task_);}
  }
  std::string result(){
    if(results_&&xQueueReceive(results_,&loop_reply_,0)==pdTRUE)return loop_reply_.body;
    return "";
  }
  std::string status()const {
    return "{\"state\":"+std::to_string(state_.load())+",\"clock\":"+(clock_valid_.load()?"true":"false")+
      ",\"saved\":"+std::to_string(saved_.load())+",\"buffered\":"+std::to_string(buffered_.load())+
      ",\"dropped\":"+std::to_string(dropped_.load())+",\"partition_bytes\":"+std::to_string(partition_bytes_.load())+"}";
  }
  void shutdown(){
    if(!task_ || !supported_.load())return;
    flush_requested_=true;xTaskNotifyGive(task_);
    for(unsigned i=0;i<200 && flush_requested_.load();++i)vTaskDelay(pdMS_TO_TICKS(10));
  }
 private:
  struct Sample {ArchivedReading row;uint32_t oldest;};
  struct Request {uint32_t date=0,from=0,until=0,oldest=0,now=0,offset=0;char token[25]{};};
  struct Reply {char body[2048]{};};
  TaskHandle_t task_=nullptr;QueueHandle_t samples_=nullptr,requests_=nullptr,results_=nullptr;
  bool attempted_=false,dirty_=false,have_hour_=false;unsigned dirty_rows_=0;
  nvs_handle_t nvs_=0;uint32_t oldest_=0,latest_=0;int64_t last_flush_=0,last_failure_=0;
  std::atomic<int> state_{STARTING};std::atomic<bool> clock_valid_{false},supported_{false},flush_requested_{false};
  std::atomic<uint32_t> saved_{0},buffered_{0},dropped_{0},partition_bytes_{0};
  ArchivedHour hour_{},export_hour_{};
  Sample worker_sample_{};Request worker_request_{};Reply worker_reply_{},loop_reply_{};
  void cleanup(){if(samples_)vQueueDelete(samples_);if(requests_)vQueueDelete(requests_);if(results_)vQueueDelete(results_);samples_=requests_=results_=nullptr;}
  static void run(void *p){static_cast<MinuteArchive *>(p)->work();}
  static std::string key(uint32_t hour){char name[12];std::snprintf(name,sizeof(name),"r%08lx",static_cast<unsigned long>(hour));return name;}
  static bool owned(const char *name,uint32_t &hour){
    if(std::strlen(name)!=9 || name[0]!='r')return false;hour=0;
    for(unsigned i=1;i<9;++i){const char c=name[i];if(c>='0'&&c<='9')hour=hour*16+c-'0';else if(c>='a'&&c<='f')hour=hour*16+c-'a'+10;else return false;}return true;
  }
  bool read_hour(uint32_t number,ArchivedHour &target,bool &missing){
    size_t size=sizeof(target);const auto result=nvs_get_blob(nvs_,key(number).c_str(),&target,&size);
    missing=result==ESP_ERR_NVS_NOT_FOUND;
    if(missing){std::memset(&target,0,sizeof(target));target.magic=0x50545231;target.hour=number;target.checksum=archive_checksum(target);return true;}
    if(result!=ESP_OK || size!=sizeof(target)||!archive_valid(target,number)){state_=READ_FAILED;return false;}
    return true;
  }
  bool room()const {
    nvs_stats_t stats{};
    return nvs_get_stats("nvs",&stats)==ESP_OK && stats.free_entries>=512+68;
  }
  bool flush(bool force=false){
    if(!dirty_)return true;
    const auto now=esp_timer_get_time();
    if(!force&&last_failure_&&now-last_failure_<60000000LL)return false;
    if(!room()){state_=SAVE_FAILED;last_failure_=now;return false;}
    hour_.checksum=archive_checksum(hour_);
    if(nvs_set_blob(nvs_,key(hour_.hour).c_str(),&hour_,sizeof(hour_))!=ESP_OK ||
       nvs_set_u32(nvs_,"latest",latest_)!=ESP_OK || nvs_commit(nvs_)!=ESP_OK){state_=SAVE_FAILED;last_failure_=now;return false;}
    saved_=latest_;buffered_=0;dirty_rows_=0;dirty_=false;last_failure_=0;last_flush_=esp_timer_get_time();state_=RECORDING;return true;
  }
  bool prune(uint32_t oldest){
    if(!oldest || oldest<=oldest_)return true;
    std::vector<std::string> expired;nvs_iterator_t iterator=nullptr;
    auto result=nvs_entry_find("nvs","paw_readings",NVS_TYPE_BLOB,&iterator);
    while(result==ESP_OK){
      nvs_entry_info_t info{};uint32_t number=0;
      if(nvs_entry_info(iterator,&info)!=ESP_OK){nvs_release_iterator(iterator);state_=READ_FAILED;return false;}
      if(owned(info.key,number) && uint64_t(number+1)*3600<=oldest)expired.emplace_back(info.key);
      if(expired.size()>192){nvs_release_iterator(iterator);state_=READ_FAILED;return false;}
      result=nvs_entry_next(&iterator);
    }
    nvs_release_iterator(iterator);
    if(result!=ESP_ERR_NVS_NOT_FOUND){state_=READ_FAILED;return false;}
    for(const auto &name:expired)if(nvs_erase_key(nvs_,name.c_str())!=ESP_OK){state_=SAVE_FAILED;return false;}
    if(!expired.empty()&&nvs_commit(nvs_)!=ESP_OK){state_=SAVE_FAILED;return false;}
    if(have_hour_&&uint64_t(hour_.hour+1)*3600<=oldest){have_hour_=false;dirty_=false;buffered_=0;dirty_rows_=0;}
    oldest_=oldest;return true;
  }
  void sample(const Sample &job){
    if(!job.row.epoch||!job.oldest || job.row.epoch<job.oldest){++dropped_;return;}
    if(job.row.epoch/60<latest_/60){state_=CLOCK_ROLLBACK;++dropped_;return;}
    if(!prune(job.oldest)){++dropped_;return;}
    const uint32_t number=job.row.epoch/3600;
    if(!have_hour_||hour_.hour!=number){
      if(!flush()){++dropped_;return;}
      bool missing=false;if(!read_hour(number,hour_,missing)){have_hour_=false;++dropped_;return;}have_hour_=true;
    }
    if(!archive_insert(hour_,job.row))return;
    if(state_.load()==CLOCK_ROLLBACK)state_=RECORDING;
    latest_=std::max(latest_,job.row.epoch);dirty_=true;++dirty_rows_;buffered_=dirty_rows_;
    if(dirty_rows_>=5 || esp_timer_get_time()-last_flush_>=300000000LL)flush();
  }
  void reply(const Request &r,const std::string &csv,uint32_t next,bool done,const char *error=nullptr){
    const auto body=esphome::json::build_json([&](JsonObject root){
      root["version"]=1;root["date"]=r.date;root["token"]=r.token;root["offset"]=r.offset;
      if(r.offset==0)root["header"]=ARCHIVE_CSV_HEADER;
      root["start"]=r.from;root["end"]=r.until;root["next"]=next;root["done"]=done;
      root["buffered"]=buffered_.load();
      if(error)root["error"]=error;else root["csv"]=csv;
    });
    std::memset(&worker_reply_,0,sizeof(worker_reply_));
    if(body.size()>=sizeof(worker_reply_.body)){
      const auto fail=std::string("{\"token\":\"")+r.token+"\",\"offset\":"+std::to_string(r.offset)+",\"error\":\"Log response exceeded safe size\"}";
      std::memcpy(worker_reply_.body,fail.c_str(),fail.size()+1);
    }else std::memcpy(worker_reply_.body,body.c_str(),body.size()+1);
    xQueueOverwrite(results_,&worker_reply_);
  }
  void export_page(const Request &r){
    if(!r.from||r.from<std::max(r.oldest,oldest_)||r.until<=r.from||r.until-r.from>26*3600U||r.offset>1560||
       uint64_t(r.from)+r.offset*60>=r.until){reply(r,"",r.offset,true,"Day is outside the retained seven-day window, or clock is unavailable");return;}
    if(!prune(r.oldest)){reply(r,"",r.offset,true,"Could not expire old archive entries");return;}
    const uint32_t from=r.from+r.offset*60,until=std::min(r.until,from+15*60);
    std::string csv;
    for(uint32_t number=from/3600;number<=(until-1)/3600;++number){
      const ArchivedHour *source=nullptr;
      if(have_hour_&&hour_.hour==number)source=&hour_;
      else {bool missing=false;if(!read_hour(number,export_hour_,missing)){reply(r,"",r.offset,true,"Saved hour could not be read or failed its checksum");return;}source=&export_hour_;}
      for(const auto &row:source->rows)if(row.epoch>=from && row.epoch<until)csv+=archive_csv_row(row);
    }
    const uint32_t next=(until-r.from)/60;
    reply(r,csv,next,until==r.until);
  }
  void work(){
    const auto *partition=esp_partition_find_first(ESP_PARTITION_TYPE_DATA,ESP_PARTITION_SUBTYPE_DATA_NVS,"nvs");
    if(!partition||partition->size<0x70000){partition_bytes_=partition?partition->size:0;state_=SMALL_PARTITION;vTaskDelete(nullptr);return;}
    partition_bytes_=partition->size;
    if(nvs_open("paw_readings",NVS_READWRITE,&nvs_)!=ESP_OK){state_=OPEN_FAILED;vTaskDelete(nullptr);return;}
    const auto latest_result=nvs_get_u32(nvs_,"latest",&latest_);
    if(latest_result!=ESP_OK&&latest_result!=ESP_ERR_NVS_NOT_FOUND){state_=READ_FAILED;nvs_close(nvs_);vTaskDelete(nullptr);return;}
    supported_=true;saved_=latest_;state_=RECORDING;last_flush_=esp_timer_get_time();
    for(;;){
      bool worked=false;
      if(xQueueReceive(requests_,&worker_request_,0)==pdTRUE){export_page(worker_request_);worked=true;}
      if(xQueueReceive(samples_,&worker_sample_,0)==pdTRUE){sample(worker_sample_);worked=true;}
      if(dirty_ && esp_timer_get_time()-last_flush_>=300000000LL)flush();
      if(flush_requested_.load() && uxQueueMessagesWaiting(samples_)==0){flush(true);flush_requested_=false;}
      if(!worked)ulTaskNotifyTake(pdTRUE,pdMS_TO_TICKS(1000));
    }
  }
};
inline MinuteArchive &minute_archive(){static MinuteArchive value;return value;}
}
