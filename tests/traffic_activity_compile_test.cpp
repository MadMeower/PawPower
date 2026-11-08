#include "../pawpower_shared/traffic_activity.h"
constexpr bool activity_test() {
  paw::TrafficActivity t;
  if(t.mask(0)!=0)return false;
  t.mark(paw::RS485_TX,0);
  if(t.mask(0)!=1 || t.mask(499)!=1 || t.mask(500)!=0)return false;
  t.mark(paw::CAN_RX,UINT32_MAX-100);
  if(t.mask(100)!=8 || t.mask(400)!=0)return false;
  t.mark(paw::CAN_TX,1000);t.mark(paw::RS485_RX,1000);
  return t.mask(1001)==6 && t.sequence[paw::RS485_TX]==1 &&
    t.sequence[paw::RS485_RX]==1 && t.sequence[paw::CAN_TX]==1 && t.sequence[paw::CAN_RX]==1;
}
static_assert(activity_test(),"Activity must expire, handle timer wrap and distinguish all four channels");
