#pragma once
#include "minute_archive_model.h"
#include <array>
#include <algorithm>
#include <vector>
#include "nvs.h"
namespace pawtracer {
// Read-only NVS handle. Called only by the existing HTTPS worker, never the bus loop.
// NVS serializes its own reads/writes; CRC validation protects archive boundaries.
class ArchiveCloudSync {
 public:
  std::string next(){
    pending_=false;
    if(!handle_&&nvs_open("paw_readings",NVS_READONLY,&handle_)!=ESP_OK)return "";
    const auto now=std::time(nullptr);if(now<1600000000)return "";
    const uint32_t current=uint32_t(now)/3600;
    if(load(current) && !acknowledged(current,hour_.checksum))return packet();
    if(current&&load(current-1)&&!acknowledged(current-1,hour_.checksum))return packet();
    std::vector<uint32_t> hours;nvs_iterator_t it=nullptr;
    auto result=nvs_entry_find("nvs","paw_readings",NVS_TYPE_BLOB,&it);
    while(result==ESP_OK){
      nvs_entry_info_t info{};if(nvs_entry_info(it,&info)!=ESP_OK)break;
      const std::string name=info.key;
      if(name.size()==9&&name[0]=='r'){
        uint32_t h=0;bool valid=true;
        for(unsigned i=1;i<9;++i){const auto c=name[i];if(c>='0'&&c<='9')h=h*16+c-'0';else if(c>='a'&&c<='f')h=h*16+c-'a'+10;else valid=false;}
        if(valid&&h!=current&&h+8*24>=current&&h<=current)hours.push_back(h);
      }
      if(hours.size()>192)break;result=nvs_entry_next(&it);
    }
    nvs_release_iterator(it);std::sort(hours.rbegin(),hours.rend());
    for(auto h:hours)if(!known(h)&&load(h))return packet();
    if(!hours.empty()&&load(hours[cursor_++%hours.size()])&&!acknowledged(hour_.hour,hour_.checksum))return packet();
    return "";
  }
  void accepted(){
    if(!pending_)return;
    Cache *slot=nullptr;
    for(auto &c:cache_)if(c.hour==hour_.hour){slot=&c;break;}
    if(!slot)for(auto &c:cache_)if(!c.hour){slot=&c;break;}
    if(!slot)slot=&*std::min_element(cache_.begin(),cache_.end(),[](const auto&a,const auto&b){return a.hour<b.hour;});
    *slot={hour_.hour,hour_.checksum};pending_=false;
  }
 private:
  struct Cache {uint32_t hour=0,crc=0;};
  std::array<Cache,192> cache_{};ArchivedHour hour_{};nvs_handle_t handle_=0;bool pending_=false;size_t cursor_=0;
  bool known(uint32_t h)const {for(const auto &c:cache_)if(c.hour==h)return true;return false;}
  bool acknowledged(uint32_t h,uint32_t crc)const {for(const auto &c:cache_)if(c.hour==h&&c.crc==crc)return true;return false;}
  bool load(uint32_t h){
    char key[16];std::snprintf(key,sizeof(key),"r%08lx",static_cast<unsigned long>(h));size_t size=sizeof(hour_);
    return nvs_get_blob(handle_,key,&hour_,&size)==ESP_OK&&size==sizeof(hour_)&&archive_valid(hour_,h);
  }
  std::string packet(){
    static constexpr char digits[]="0123456789abcdef";
    std::string hex;hex.reserve(sizeof(hour_)*2);
    const auto *bytes=reinterpret_cast<const uint8_t *>(&hour_);
    for(size_t i=0;i<sizeof(hour_);++i){hex+=digits[bytes[i]>>4];hex+=digits[bytes[i]&15];}
    pending_=true;
    return "{\"hour\":"+std::to_string(hour_.hour)+",\"hex\":\""+hex+"\"}";
  }
};
inline ArchiveCloudSync &archive_cloud_sync(){static ArchiveCloudSync source;return source;}
inline std::string archive_cloud_next(){return archive_cloud_sync().next();}
inline void archive_cloud_accepted(){archive_cloud_sync().accepted();}
}
