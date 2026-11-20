#pragma once
#include <cstdint>

namespace paw {
struct EventRecord {int64_t epoch=0;uint8_t code=0;};
// Observations of the bridge, not acknowledgements from the inverter.
// Clockless transitions cannot be dated and are intentionally not invented.
class EventHistory {
 public:
  template<class Emit> void tick(uint32_t ms,int64_t epoch,bool clock_valid,
      bool fresh,bool ready,bool enabled,bool active,bool charge,bool discharge,
      bool soc,bool cold,bool hot,bool low,Emit emit) {
    if(!clock_valid){baseline_=false;return;}
    const auto send=[&](uint8_t code){emit(EventRecord{epoch,code});};
    if(!started_){send(1);started_=true;}
    if(!baseline_){send(18);baseline_=true;have_fresh_=fresh;fresh_=fresh;enabled_=enabled;active_=active;held_=false;inactive_pending_=false;}
    else {
      if(fresh!=fresh_) {
        if(fresh){send(3);have_fresh_=true;}
        else if(have_fresh_)send(2);
        fresh_=fresh;
      }
      if(enabled!=enabled_){send(enabled?13:12);enabled_=enabled;}
      // Debounce only the event report. Never alter CAN or safety timing.
      if(active){
        inactive_pending_=false;
        if(!active_){send(20);active_=true;}
      }else if(active_){
        if(!inactive_pending_){inactive_since_=ms;inactive_pending_=true;}
        if(uint32_t(ms-inactive_since_)>=5000U){send(19);active_=false;inactive_pending_=false;}
      }
    }
    // Reject/stale/recovery states set conservative holds internally; do not
    // mislabel them as actual cold/hot/SOC threshold crossings.
    if(!ready || !fresh){held_=false;return;}
    const bool state[]={soc,cold,hot,low,charge,discharge};
    const uint8_t on[]={8,4,6,16,11,15},off[]={9,5,7,17,10,14};
    for(unsigned i=0;i<6;++i) {
      if(held_ ? state[i]!=previous_[i] : (i<4 && state[i]))send(state[i]?on[i]:off[i]);
      previous_[i]=state[i];
    }
    held_=true;
  }
 private:
  bool started_=false,baseline_=false,have_fresh_=false,fresh_=false;
  bool enabled_=false,active_=false,held_=false,previous_[6]{};
  bool inactive_pending_=false;
  uint32_t inactive_since_=0;
};
} // namespace paw
