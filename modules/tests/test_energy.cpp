#include "../tracer_shared/energy_tracker.h"
#include <cassert>
#include <cstdlib>
int main(){
 setenv("TZ","UTC",1);tzset();
 paw::EnergyStore s; paw::EnergyTracker t;const time_t base=1794744000;
 for(unsigned i=0;i<=100;i++)t.sample(s,i*6000,base+i*6,true,600);
 auto d=paw::find(s,paw::date_key(base));assert(d&&std::fabs(d->charged_wh-100)<.0001&&d->discharged_wh==0);
 t.sample(s,1000000,base+1000,true,600);assert(std::fabs(d->charged_wh-100)<.0001&&d->partial);
 // Restore bytes and start a fresh tracker: do not integrate across a restart.
 paw::EnergyBytes bytes{};std::memcpy(bytes.data(),&s,sizeof(s));auto restored=paw::load_energy(bytes);paw::EnergyTracker reboot;
 reboot.sample(restored,6000,base+1010,true,600);auto r=paw::find(restored,paw::date_key(base));assert(r&&r->charged_wh==d->charged_wh);
 assert(paw::energy_json(restored,base+1010,true).find("0.100000")!=std::string::npos);
}
