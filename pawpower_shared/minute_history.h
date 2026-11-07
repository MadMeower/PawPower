#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>

namespace paw {
struct MinuteRecord {
  int64_t minute=0;
  double seconds=0,volt_seconds=0,amp_seconds=0,soc_seconds=0,watt_seconds=0;
  double charged_wh=0,discharged_wh=0;
  bool startup=false,clock_gap=false;
};
// Called only by the ESPHome loop. Integrates distinct, validated shunt replies;
// duplicate/stale values never contribute invented coverage or energy.
class MinuteHistory {
 public:
  constexpr bool tick(uint32_t ms,int64_t epoch,bool clock_valid,bool received,uint32_t sample_ms,
            double volts,double amps,double soc,MinuteRecord &ready) {
    if(!clock_valid){have_sample_=false;clock_lost_=true;return false;}
    const int64_t minute=epoch/60;
    bool emit=false;
    if(!initialized_) {
      current_.minute=minute;current_.startup=true;initialized_=true;
    } else if(clock_lost_ || minute<current_.minute || minute>current_.minute+1) {
      // Clock corrections or loop outages are visible as gaps, never integrated.
      current_=MinuteRecord{};current_.minute=minute;current_.clock_gap=true;
      pending_=MinuteRecord{};have_pending_=false;have_sample_=false;
    } else if(minute==current_.minute+1) {
      if(have_pending_){ready=pending_;emit=true;}
      pending_=current_;have_pending_=true;
      current_=MinuteRecord{};current_.minute=minute;
    }
    clock_lost_=false;
    const uint32_t age=ms-sample_ms;
    const bool fresh=received && age<15000 && finite(volts) && finite(amps) && finite(soc);
    if(!fresh)have_sample_=false;
    else if(!have_seen_ || sample_ms!=seen_ms_) {
      const int64_t sample_epoch=epoch-age/1000;
      if(have_sample_) {
        const double seconds=uint32_t(sample_ms-previous_ms_)/1000.0;
        const int64_t wall=sample_epoch-previous_epoch_;
        const double clock_difference=double(wall)-seconds;
        // Polling is every five seconds. A ten-second gap means a missed reply,
        // so do not interpolate across it as though that interval was observed.
        if(seconds>0 && seconds<=7.5 && wall>0 && clock_difference>=-2 && clock_difference<=2) {
          int64_t from=previous_epoch_;
          while(from<sample_epoch) {
            const int64_t to=std::min(sample_epoch,(from/60+1)*60);
            MinuteRecord *bucket=(from/60==current_.minute)?&current_:
              (have_pending_ && from/60==pending_.minute)?&pending_:nullptr;
            if(bucket) {
              const double a=double(from-previous_epoch_)/wall,b=double(to-previous_epoch_)/wall;
              integrate(*bucket,a,b,seconds,volts,amps,soc);
            }
            from=to;
          }
        }
      }
      previous_ms_=sample_ms;previous_epoch_=sample_epoch;
      previous_v_=volts;previous_a_=amps;previous_soc_=soc;
      have_sample_=true;have_seen_=true;seen_ms_=sample_ms;
    }
    // Wait 15 seconds for the last 5-second reply interval to cross the boundary.
    if(!emit && have_pending_ && epoch>=pending_.minute*60+75) {
      ready=pending_;have_pending_=false;emit=true;
    }
    return emit;
  }
 private:
  static constexpr bool finite(double v){return v>=-1e300 && v<=1e300;}
  static constexpr double positive(double a,double b,double dt) {
    if(a>=0 && b>=0)return (a+b)*0.5*dt;
    if(a<=0 && b<=0)return 0;
    return a>0?0.5*a*dt*a/(a-b):0.5*b*dt*b/(b-a);
  }
  constexpr void integrate(MinuteRecord &r,double a,double b,double seconds,double v,double amps,double soc) {
    const double dt=seconds*(b-a);
    const auto avg=[a,b](double old,double value){return old+(value-old)*(a+b)*0.5;};
    const double old_w=previous_v_*previous_a_,w=v*amps;
    const double p0=old_w+(w-old_w)*a,p1=old_w+(w-old_w)*b;
    r.seconds+=dt;r.volt_seconds+=avg(previous_v_,v)*dt;
    r.amp_seconds+=avg(previous_a_,amps)*dt;r.soc_seconds+=avg(previous_soc_,soc)*dt;
    r.watt_seconds+=(p0+p1)*0.5*dt;
    r.charged_wh+=positive(p0,p1,dt)/3600;
    r.discharged_wh+=positive(-p0,-p1,dt)/3600;
  }
  MinuteRecord current_{},pending_{};
  bool initialized_=false,have_pending_=false,have_sample_=false,have_seen_=false,clock_lost_=false;
  uint32_t previous_ms_=0,seen_ms_=0;
  int64_t previous_epoch_=0;
  double previous_v_=0,previous_a_=0,previous_soc_=0;
};
} // namespace paw
