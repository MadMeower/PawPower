#pragma once
#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <cstdio>
#include <string>
#include <type_traits>

namespace paw {
struct CycleStore {
  uint32_t magic=0x50414331,version=1;
  double discharged_ah=0,cycles=0,seconds=0;
  int64_t started=0;
  uint32_t gaps=0;
};
using CycleBytes=std::array<uint8_t,64>;
static_assert(sizeof(CycleStore)<=sizeof(CycleBytes));
static_assert(std::is_trivially_copyable<CycleStore>::value);
inline CycleStore load_cycles(const CycleBytes &bytes){
  CycleStore s;std::memcpy(&s,bytes.data(),sizeof(s));
  if(s.magic!=0x50414331 || s.version!=1 || !std::isfinite(s.discharged_ah) ||
     !std::isfinite(s.cycles) || !std::isfinite(s.seconds) || s.discharged_ah<0 ||
     s.cycles<0 || s.seconds<0)return CycleStore{};
  return s;
}
class CycleTracker {
 public:
  void sample(CycleBytes &bytes,uint32_t ms,int64_t epoch,bool clock_valid,double amps,double capacity){
    if(!std::isfinite(amps) || std::fabs(amps)>600 || !std::isfinite(capacity) || capacity<=0){have_=false;return;}
    auto s=load_cycles(bytes);
    if(!s.started && clock_valid)s.started=epoch;
    if(have_){
      const double dt=uint32_t(ms-previous_ms_)/1000.0;
      if(dt>0 && dt<=7.5){
        // Integrate only discharge. A change of sign splits at zero current.
        const double ah=positive(-previous_amps_,-amps,dt)/3600.0;
        // A capacity change starts a new baseline; previous cycles are retained.
        if(capacity==previous_capacity_){s.discharged_ah+=ah;s.seconds+=dt;s.cycles+=ah/capacity;}
        else ++s.gaps;
      }else if(dt>7.5)++s.gaps;
    }
    previous_ms_=ms;previous_amps_=amps;previous_capacity_=capacity;have_=true;
    std::memcpy(bytes.data(),&s,sizeof(s));
  }
 private:
  static double positive(double a,double b,double dt){
    if(a>=0 && b>=0)return (a+b)*0.5*dt;
    if(a<=0 && b<=0)return 0;
    return a>0?0.5*a*dt*a/(a-b):0.5*b*dt*b/(b-a);
  }
  bool have_=false;uint32_t previous_ms_=0;
  double previous_amps_=0,previous_capacity_=0;
};
inline CycleTracker &cycle_tracker(){static CycleTracker tracker;return tracker;}
inline std::string cycle_json(const CycleBytes &bytes){
  const auto s=load_cycles(bytes);char out[240];
  std::snprintf(out,sizeof(out),"{\"cycles\":%.6f,\"discharged_ah\":%.3f,\"hours\":%.3f,\"started\":%lld,\"gaps\":%lu}",
    s.cycles,s.discharged_ah,s.seconds/3600.0,static_cast<long long>(s.started),static_cast<unsigned long>(s.gaps));
  return out;
}
} // namespace paw
