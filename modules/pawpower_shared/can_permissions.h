#pragma once
#include <cstdint>

namespace paw {
// Snapshot of the permission byte queued in 0x35C, not inverter feedback.
struct CanPermissions {
  bool active=false, charge=false, discharge=false;
};
class CanPermissionSnapshot {
 public:
  constexpr void clear(){valid_=false;}
  constexpr void queued(uint32_t ms,uint8_t flags){at_=ms;flags_=flags;valid_=true;}
  constexpr CanPermissions get(uint32_t ms,bool enabled)const {
    if(!enabled || !valid_ || uint32_t(ms-at_)>=2500U)return {};
    return {true,bool(flags_&0x80),bool(flags_&0x40)};
  }
 private:
  uint32_t at_=0;
  uint8_t flags_=0;
  bool valid_=false;
};
}
