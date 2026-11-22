#pragma once
#include <array>
#include <algorithm>
#include <cstdint>
#include <cstddef>
#ifdef ESP_PLATFORM
#include "esp_system.h"
#endif
#include <cstring>
#include <string>
#include <type_traits>
namespace pawdiag {
struct Entry {uint32_t epoch=0;uint16_t code=0,detail=0;};
struct Day {uint32_t date=0,omitted=0;uint16_t count=0,next=0;std::array<Entry,32> entries{};};
struct Store {uint32_t magic=0x50454531,latest=0;std::array<Day,7> days{};uint32_t checksum=0;};
static_assert(sizeof(Store)<=2048,"Error history must fit its existing-size preferences blob");
static_assert(std::is_trivially_copyable<Store>::value,"History must be persistable");
class History {
 public:
  void tick(std::array<uint8_t,2048> &bytes,uint32_t epoch,uint32_t date,uint32_t oldest,uint16_t reset_reason) {
    if(!epoch || !date){clock_=false;return;}
    clock_=true;epoch_=epoch;date_=date;
    if(!loaded_) {
      std::memcpy(&store_,bytes.data(),sizeof(store_));
      bool valid=store_.magic==0x50454531 && store_.checksum==hash(store_);
      for(const auto &d:store_.days)valid=valid && d.count<=32 && d.next<32;
      if(!valid){std::memset(&store_,0,sizeof(store_));store_.magic=0x50454531;}
      loaded_=true;
    }
    // Refuse back-dated writes after a clock rollback. Do not reintroduce expired days.
    rollback_=date<store_.latest;
    if(rollback_)return;
    bool changed=false;
    for(auto &d:store_.days)if(d.date && d.date<oldest){d=Day{};changed=true;}
    if(date>store_.latest){store_.latest=date;changed=true;}
    bytes_=&bytes;
    if(!started_){started_=true;record(1,reset_reason);}
    else if(changed)persist();
  }
  void observe(unsigned channel,uint16_t code,uint16_t value,bool known=true) {
    if(!clock_||rollback_||!loaded_||channel>=values_.size()||!known)return;
    if(!seen_[channel]){seen_[channel]=true;values_[channel]=value;if(value)record(code,value);}
    else if(values_[channel]!=value){values_[channel]=value;record(code,value);}
  }
  void counter(unsigned channel,uint16_t code,uint32_t total,uint32_t ms) {
    if(channel>=counts_.size())return;
    if(!counter_seen_[channel]){counter_seen_[channel]=true;counts_[channel]=0;}
    if(total<counts_[channel])counts_[channel]=total;
    if(!clock_||rollback_||total==counts_[channel])return;
    if(counter_sent_[channel] && uint32_t(ms-counter_at_[channel])<60000U)return;
    record(code,uint16_t(std::min(uint32_t(65535),total-counts_[channel])));
    counts_[channel]=total;counter_at_[channel]=ms;counter_sent_[channel]=true;
  }
  void request(const std::string &value) {
    const auto split=value.find('|');const auto date=value.substr(0,split);
    if(date.size()!=10 || date[4]!='-' || date[7]!='-')return;
    uint32_t key=0;
    for(size_t i=0;i<date.size();++i)if(i!=4&&i!=7){if(date[i]<'0'||date[i]>'9')return;key=key*10+date[i]-'0';}
    selected_=key;token_=split==std::string::npos?"":value.substr(split+1,32);++revision_;
  }
  std::string json()const {
    std::string out="{\"clock\":"+std::string(clock_?"true":"false")+",\"rollback\":"+(rollback_?"true":"false")+
      ",\"date\":"+std::to_string(selected_?selected_:date_)+",\"token\":\"";
    // Tokens are generated hex by the page; never reflect arbitrary text.
    for(char c:token_)if((c>='0'&&c<='9')||(c>='a'&&c<='f'))out+=c;
    out+="\",\"days\":[";
    bool first=true;for(const auto &d:store_.days)if(d.date){if(!first)out+=",";first=false;out+=std::to_string(d.date);}
    out+="],\"omitted\":";const Day *day=nullptr;
    for(const auto &d:store_.days)if(d.date==(selected_?selected_:date_))day=&d;
    out+=std::to_string(day?day->omitted:0)+",\"entries\":[";
    if(day)for(unsigned i=0;i<day->count;++i){
      const auto &e=day->entries[((day->count==32?day->next:0)+i)%32];
      if(i)out+=",";out+="["+std::to_string(e.epoch)+","+std::to_string(e.code)+","+std::to_string(e.detail)+"]";
    }
    return out+"]}";
  }
  std::string cloud_json(uint32_t other_date)const {
    std::string out="{\"clock\":"+std::string(clock_?"true":"false")+",\"rollback\":"+(rollback_?"true":"false")+",\"days\":[";
    bool first=true;
    if(loaded_&&clock_&&!rollback_)for(uint32_t date : {date_,other_date}) {
      if(!date || (!first&&date==date_))continue;
      const Day *day=nullptr;for(const auto &d:store_.days)if(d.date==date)day=&d;
      if(!first)out+=",";first=false;
      out+="{\"date\":"+std::to_string(date)+",\"omitted\":"+std::to_string(day?day->omitted:0)+",\"entries\":[";
      if(day)for(unsigned i=0;i<day->count;++i){
        const auto &e=day->entries[((day->count==32?day->next:0)+i)%32];
        if(i)out+=",";out+="["+std::to_string(e.epoch)+","+std::to_string(e.code)+","+std::to_string(e.detail)+"]";
      }
      out+="]}";
    }
    return out+"]}";
  }
  void event(uint16_t code,uint16_t detail){if(clock_&&!rollback_&&loaded_)record(code,detail);}
  uint32_t revision()const{return revision_;}
  const Store &store()const{return store_;}
 private:
  static uint32_t hash(const Store &s){
    const auto *p=reinterpret_cast<const uint8_t *>(&s);uint32_t h=2166136261U;
    for(size_t i=0;i<offsetof(Store,checksum);++i){h^=p[i];h*=16777619U;}return h;
  }
  void persist(){if(!bytes_)return;store_.checksum=hash(store_);std::memcpy(bytes_->data(),&store_,sizeof(store_));++revision_;}
  void record(uint16_t code,uint16_t detail){
    if(!bytes_ || rollback_)return;
    Day *day=nullptr;for(auto &d:store_.days)if(d.date==date_)day=&d;
    if(!day){for(auto &d:store_.days)if(!d.date){day=&d;break;}}
    if(!day)return;
    if(!day->date)day->date=date_;
    if(day->count==32){if(day->omitted<UINT32_MAX)++day->omitted;}else ++day->count;
    day->entries[day->next]={epoch_,code,detail};day->next=(day->next+1)%32;persist();
  }
  Store store_{};
  std::array<uint8_t,2048> *bytes_=nullptr;
  std::array<uint16_t,12> values_{};std::array<bool,12> seen_{};
  std::array<uint32_t,4> counts_{},counter_at_{};std::array<bool,4> counter_seen_{},counter_sent_{};
  bool loaded_=false,started_=false,clock_=false,rollback_=false;
  uint32_t epoch_=0,date_=0,selected_=0,revision_=0;std::string token_;
};
inline History &history(){static History value;return value;}
}
