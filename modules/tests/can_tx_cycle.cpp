#include "../pawpower_shared/can_tx_cycle.h"
constexpr bool paced(){
 paw::CanTxCycle c;c.start(1000);
 if(!c.due(1000))return false;
 for(unsigned i=0;i<7;++i){
  const auto at=1000U+i*6;
  if(c.index()!=i||!c.due(at))return false;
  c.sent(at);
  if(!c.waiting()||c.due(at+1))return false;
  const bool done=c.acknowledged(at+1);
  if(done!=(i==6))return false;
  if(i<6 && c.due(at+5))return false;
 }
 return !c.active()&&!c.waiting()&&c.index()==7;
}
constexpr bool deadlines(){
 paw::CanTxCycle c;c.start(0);c.sent(0);
 if(c.expired(99)||!c.expired(100))return false;
 c.acknowledged(150); // The hardware ACK arrived; only observing it was delayed.
 if(c.index()!=1 || c.waiting() || !c.due(155))return false;
 c.start(0);c.sent(0);if(c.acknowledged(500)||c.index()!=0)return false;
 c.start(1000);if(c.expired(1499)||!c.expired(1500)||c.due(1500))return false;
 c.cancel();return !c.active()&&!c.waiting()&&!c.due(2000);
}
constexpr bool delayed_loop(){
 paw::CanTxCycle c;c.start(0);uint32_t now=0;
 for(unsigned i=0;i<7;++i){
  if(!c.due(now))return false;
  c.sent(now);now+=i==0?150:40;
  const bool done=c.acknowledged(now);
  if(done!=(i==6)||c.index()!=i+1)return false;
  now+=5;
 }
 return !c.active();
}
static_assert(delayed_loop(),"Complete a batch when the first hardware ACK is observed after 150 ms");
constexpr bool wrap(){
 paw::CanTxCycle c;c.start(0xfffffff0U);c.sent(0xfffffff0U);
 if(c.expired(0x20U))return false;
 c.acknowledged(0x20U);
 return !c.due(0x24U)&&c.due(0x25U)&&c.expired(0x1e4U);
}
constexpr bool recovery(){
 paw::CanTxHealth h;h.failed();
 for(int i=0;i<20;++i)h.completed(167,0);
 if(!h.fault())return false;
 for(int i=0;i<4;++i)h.completed(0,0);
 if(!h.fault())return false;
 h.failed();
 for(int i=0;i<4;++i)h.completed(0,0);
 if(!h.fault())return false;
 h.completed(0,0);if(h.fault())return false;
 h.completed(0,96);return h.fault();
}
static_assert(paced(),"Seven acknowledged frames, no bursts or early advancement");
static_assert(deadlines(),"Accept delayed observation of hardware ACKs, reject stale batches");
static_assert(wrap(),"Pacing and deadlines survive millis rollover");
static_assert(recovery(),"Do not declare recovery with elevated counters or isolated clean cycles");
