#include "../tracer_shared/tracer_bus.h"
#include <cassert>
#include <initializer_list>
using pawtracer::Bus;
void feed(Bus &b,std::initializer_list<uint8_t> bytes,uint32_t now){for(auto v:bytes)b.feed(v,now);}
int main(){
 Bus b;
 feed(b,{1,4,0x31,0,0,4,0xff,0x35},10);
 feed(b,{1,4,8,0x24,0xcf,0,0x73,0x2a,0x8f,0,0,0x24,0xd2},20);
 assert(b.matched==1 && std::fabs(b.values[Bus::PV_W]-108.95f)<.01);
 assert(std::fabs(b.values[Bus::PV_V]-94.23f)<.01);
 feed(b,{1,4,0x33,0x1a,0,1,0x1f,0x49},30);
 feed(b,{1,4,2,0x14,0x5d,0x77,0xc9},40);
 assert(b.matched==2 && std::fabs(b.values[Bus::BAT_V]-52.13f)<.01);
 // Orphan never assigns a register; corrupted packet never publishes.
 feed(b,{1,4,2,0x14,0x5d,0x77,0xc9},50);assert(b.matched==2);
 feed(b,{1,4,0x33,0x1a,0,1,0x1f,0x49},60);
 feed(b,{1,4,2,0x14,0x5c,0x77,0xc9},70);assert(b.matched==2);
 // An expired request is not used to decode a late response.
 b.mode(false);feed(b,{1,4,0x33,0x1a,0,1,0x1f,0x49},100);
 feed(b,{1,4,2,0x14,0x5d,0x77,0xc9},2000);assert(b.matched==2);
 for(int i=0;i<100;i++)assert(b.poll(i*1000).empty());
 b.mode(true);auto r=b.poll(3000);assert(r.size()==8 && Bus::valid(r.data(),r.size()));
 feed(b,{1,4,8,0x24,0xcf,0,0x73,0x2a,0x8f,0,0,0x24,0xd2},3010);
 assert(b.matched==3);assert(b.poll(3200).empty());
 b.mode(false);assert(b.poll(5000).empty());
}
