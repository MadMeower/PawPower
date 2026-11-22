#pragma once
#include <cstdint>
namespace paw {
// One outstanding single-shot frame. No delayed batch may survive its deadline.
class CanTxCycle {
 public:
  constexpr void start(uint32_t ms){started_=at_=ms;index_=0;active_=true;waiting_=false;}
  constexpr void cancel(){active_=false;waiting_=false;}
  constexpr bool active()const{return active_;}
  constexpr bool waiting()const{return waiting_;}
  constexpr uint8_t index()const{return index_;}
  constexpr uint32_t age(uint32_t ms)const{return uint32_t(ms-started_);}
  constexpr uint32_t frame_age(uint32_t ms)const{return uint32_t(ms-at_);}
  constexpr bool batch_expired(uint32_t ms)const{return active_ && age(ms)>=500U;}
  constexpr bool expired(uint32_t ms)const {
    return batch_expired(ms) || (active_ && waiting_ && frame_age(ms)>=100U);
  }
  constexpr bool due(uint32_t ms)const {
    return active_ && !waiting_ && !expired(ms) && (index_==0 || uint32_t(ms-at_)>=5U);
  }
  constexpr void sent(uint32_t ms){if(due(ms)){at_=ms;waiting_=true;}}
  constexpr bool acknowledged(uint32_t ms){
    // A hardware success may be observed late by the main loop. Only the
    // snapshot deadline invalidates that ACK; software observation delay does not.
    if(!active_ || !waiting_ || batch_expired(ms))return false;
    waiting_=false;at_=ms;
    if(++index_==7){active_=false;return true;}
    return false;
  }
 private:
  uint32_t started_=0,at_=0;
  uint8_t index_=0;
  bool active_=false,waiting_=false;
};
// Verify a queued baseline batch on the following tick, using driver counters.
class CanBatchReceipt {
 public:
  enum Result { NONE, PENDING, COMPLETE, FAILED };
  constexpr void queued(uint32_t failed,uint32_t errors){pending_=true;failed_=failed;errors_=errors;}
  constexpr void cancel(){pending_=false;}
  constexpr Result check(uint32_t outstanding,uint32_t failed,uint32_t errors){
    if(!pending_)return NONE;
    if(failed!=failed_ || errors!=errors_){pending_=false;return FAILED;}
    if(outstanding)return PENDING;
    pending_=false;return COMPLETE;
  }
 private:
  uint32_t failed_=0,errors_=0;
  bool pending_=false;
};
class CanTxHealth {
 public:
  constexpr void failed(){fault_=true;clean_=0;}
  constexpr bool fault()const{return fault_;}
  // Only complete, acknowledged batches with counters below warning level count.
  constexpr void completed(uint32_t tec,uint32_t rec){
    if(tec>=96 || rec>=96){failed();return;}
    if(fault_ && ++clean_>=5){fault_=false;clean_=0;}
  }
 private:
  bool fault_=false;
  uint8_t clean_=0;
};
}
