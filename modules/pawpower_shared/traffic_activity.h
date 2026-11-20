#pragma once
#include <array>
#include <cstdint>

namespace paw {
enum TrafficPort { RS485_TX, RS485_RX, CAN_TX, CAN_RX };
struct ActivityStamp {
  uint32_t ms=0;
  bool seen=false;
  constexpr void mark(uint32_t now){ms=now;seen=true;}
  constexpr bool recent(uint32_t now){
    if(seen && uint32_t(now-ms)>=500)seen=false;
    return seen;
  }
};
struct TrafficActivity {
  std::array<ActivityStamp,4> ports{};
  // Sequence numbers let web clients observe short bursts between snapshots.
  // They count activity notifications, not necessarily individual bus frames.
  std::array<uint32_t,4> sequence{};
  constexpr void mark(TrafficPort port,uint32_t ms){ports[port].mark(ms);++sequence[port];}
  constexpr uint8_t mask(uint32_t ms) {
    uint8_t result=0;
    for(unsigned i=0;i<ports.size();++i)if(ports[i].recent(ms))result|=uint8_t(1U<<i);
    return result;
  }
};
inline TrafficActivity &traffic_activity(){static TrafficActivity activity;return activity;}
} // namespace paw
