// Compile with C++20: assertions execute the actual recorder during compilation.
// No emulator, board, filesystem or battery/CAN traffic is involved.
#include "../pawpower_shared/minute_history.h"
using paw::MinuteHistory;
using paw::MinuteRecord;
constexpr bool near(double a,double b){return a-b<0.000001 && b-a<0.000001;}
constexpr MinuteRecord simulate(int mode,uint32_t base_ms=100000,int end=75) {
  MinuteHistory recorder;MinuteRecord output{},row{};
  for(int second=0;second<=end;++second) {
    int sample=mode==2?0:second/5*5;
    if(mode==5 && sample==5)sample=0;
    const double amps=mode==1 && sample>=15?-10:10;
    const bool received=mode!=3 && !(mode==4 && second>10 && second<40);
    if(recorder.tick(base_ms+uint32_t(second*1000),6000+second,true,received,
        base_ms+uint32_t(sample*1000),50,amps,60,row))output=row;
  }
  return output;
}
constexpr auto charge=simulate(0);
static_assert(charge.minute==100 && charge.startup);
static_assert(near(charge.seconds,60));
static_assert(near(charge.volt_seconds/charge.seconds,50));
static_assert(near(charge.amp_seconds/charge.seconds,10));
static_assert(near(charge.charged_wh,500.0/60));
static_assert(near(charge.discharged_wh,0));
constexpr auto reversal=simulate(1);
static_assert(near(reversal.charged_wh,5625.0/3600));
static_assert(near(reversal.discharged_wh,23125.0/3600));
static_assert(near(simulate(2).seconds,0),"Duplicate shunt replies must not count twice");
static_assert(near(simulate(3).seconds,0),"No-data minutes must have zero coverage");
static_assert(near(simulate(4).seconds,30),"Do not integrate across lost shunt replies");
static_assert(near(simulate(5).seconds,50),"A missing scheduled reply must reduce coverage");
static_assert(near(simulate(0,UINT32_MAX-10000).seconds,60),"millis wrap must retain valid coverage");
constexpr auto second_minute=simulate(0,100000,135);
static_assert(second_minute.minute==101 && !second_minute.startup);
static_assert(near(second_minute.seconds,60));
constexpr bool clock_loss() {
  MinuteHistory h;MinuteRecord row{},result{};
  for(int s=0;s<=75;++s) {
    if(h.tick(100000+s*1000,6000+s,s<10 || s>=30,true,
        100000+(s/5*5)*1000,50,10,60,row))result=row;
  }
  return result.clock_gap && near(result.seconds,30);
}
static_assert(clock_loss(),"Clock loss resets integration and marks the minute");
constexpr bool late_start() {
  MinuteHistory h;MinuteRecord row{},result{};
  for(int s=12;s<=75;++s) {
    if(h.tick(100000+s*1000,6000+s,true,true,
        100000+(12+(s-12)/5*5)*1000,50,-10,60,row))result=row;
  }
  return result.startup && near(result.seconds,48) && near(result.discharged_wh,500.0*48/3600);
}
static_assert(late_start(),"Restart mid-minute must preserve only observed coverage");
