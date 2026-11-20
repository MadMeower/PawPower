#pragma once
#include "energy_tracker.h"

namespace paw {
struct DisconnectDay {int32_t date=0;uint32_t count=0;double seconds=0;};
struct DisconnectStore {
  uint32_t version=1;
  std::array<DisconnectDay,31> days{};
  int64_t last_start=0;
  double last_duration=0;
  bool unfinished=false;
};
using DisconnectBytes=std::array<uint8_t,768>;
static_assert(sizeof(DisconnectStore)<=sizeof(DisconnectBytes),"Disconnect store too large");
static_assert(std::is_trivially_copyable<DisconnectStore>::value,"Disconnect store must persist");
inline DisconnectStore load_disconnects(const DisconnectBytes &bytes) {
  DisconnectStore s{};std::memcpy(&s,bytes.data(),sizeof(s));
  return s.version==1?s:DisconnectStore{};
}
inline DisconnectDay *disconnect_day(DisconnectStore &s,int32_t date) {
  for(auto &d:s.days) if(d.date==date) return &d;
  if(date<s.days[0].date) return nullptr;
  for(size_t i=s.days.size()-1;i>0;--i)s.days[i]=s.days[i-1];
  s.days[0]=DisconnectDay{};s.days[0].date=date;return &s.days[0];
}
class DisconnectTracker {
 public:
  void tick(DisconnectBytes &bytes,uint32_t ms,time_t epoch,bool clock_valid,
            bool have_reply,uint32_t last_reply) {
    auto s=load_disconnects(bytes);
    if(!initialized_) {interrupted_=s.unfinished;initialized_=true;}
    // No invented timestamps or counting startup as a lost shunt connection.
    if(!clock_valid) {if(active_)interrupted_=true;previous_valid_=false;return;}
    const bool lost=have_reply && uint32_t(ms-last_reply)>=20000;
    const double dt=uint32_t(ms-previous_ms_)/1000.0;
    const double wall=difftime(epoch,previous_epoch_);
    if(active_ && previous_valid_ && (dt>5 || wall<=0 || std::abs(wall-dt)>2))interrupted_=true;
    if(active_ && previous_valid_ && dt>0 && dt<=5) {
      s.last_duration+=dt;
      if(wall>0 && std::abs(wall-dt)<=2) {
        time_t from=previous_epoch_;
        while(from<epoch) {
          const time_t to=std::min(epoch,day_start(from,1));
          if(to<=from) break;
          if(auto *d=disconnect_day(s,date_key(from)))d->seconds+=dt*difftime(to,from)/wall;
          from=to;
        }
      }
    }
    if(!active_ && lost) {
      active_=true;interrupted_=false;
      s.last_start=epoch;s.last_duration=0;s.unfinished=true;
      if(auto *d=disconnect_day(s,date_key(epoch)))++d->count;
    } else if(active_ && !lost) {active_=false;s.unfinished=false;}
    // Ensure today's row exists, including zero observed outages.
    disconnect_day(s,date_key(epoch));
    std::memcpy(bytes.data(),&s,sizeof(s));
    previous_ms_=ms;previous_epoch_=epoch;previous_valid_=true;
  }
  bool active()const{return active_;}
  bool interrupted()const{return interrupted_;}
 private:
  bool initialized_=false,active_=false,interrupted_=false,previous_valid_=false;
  uint32_t previous_ms_=0;
  time_t previous_epoch_=0;
};
inline DisconnectTracker &disconnect_tracker(){static DisconnectTracker t;return t;}
inline std::string disconnect_json(const DisconnectBytes &bytes,time_t epoch,bool clock_valid) {
  if(!clock_valid)return "{\"clock\":false,\"days\":[]}";
  auto s=load_disconnects(bytes);
  char head[256];
  snprintf(head,sizeof(head),"{\"clock\":true,\"active\":%s,\"interrupted\":%s,\"last_start\":%lld,\"last_duration\":%.1f,\"days\":[",
    disconnect_tracker().active()?"true":"false",disconnect_tracker().interrupted()?"true":"false",
    static_cast<long long>(s.last_start),s.last_duration);
  std::string json=head;
  for(int i=0;i<=30;++i) {
    const auto key=date_key(day_start(epoch,-i));
    const DisconnectDay *found=nullptr;
    for(const auto &d:s.days)if(d.date==key){found=&d;break;}
    char row[160];
    if(found)snprintf(row,sizeof(row),"%s{\"date\":\"%04d-%02d-%02d\",\"count\":%u,\"seconds\":%.1f}",i?",":"",int(key/10000),int(key/100%100),int(key%100),unsigned(found->count),found->seconds);
    else snprintf(row,sizeof(row),"%s{\"date\":\"%04d-%02d-%02d\",\"missing\":true}",i?",":"",int(key/10000),int(key/100%100),int(key%100));
    json+=row;
  }
  return json+"]}";
}
}
