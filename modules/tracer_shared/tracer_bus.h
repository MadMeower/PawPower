#pragma once
#include <array>
#include <vector>
#include <cstdint>
#include <cstddef>
#include <cmath>
#include <string>
namespace pawtracer {
class Bus {
 public:
  enum Field { PV_V, PV_A, PV_W, BAT_V, BAT_A, BAT_T, CTRL_T, SOC, CURRENT_LOW, COUNT };
  enum ChargeCommand { NEVER=0, QUEUED=1, WAITING=2, ACKNOWLEDGED=3, REJECTED=4,
                       TIMEOUT=5, LISTEN_ONLY=6, CANCELLED=7 };
  std::array<float,COUNT> values{};
  std::array<uint32_t,COUNT> stamps{}, revisions{};
  uint32_t matched=0, orphan=0, exceptions=0;
  bool polling=false;
  std::string charge_json(uint32_t now) const {
    return std::string("{\"sequence\":")+std::to_string(charge_sequence_)+
      ",\"state\":"+std::to_string(unsigned(charge_command_))+
      ",\"requested\":"+(have_charge_request_?(charge_enabled_?"true":"false"):"null")+
      ",\"exception\":"+std::to_string(charge_exception_)+
      ",\"status\":"+(have_charge_status_?std::to_string(charge_status_):"null")+
      ",\"age\":"+(have_charge_status_?std::to_string(uint32_t(now-charge_status_at_)/1000.0f):"null")+"}";
  }
  std::string dashboard(uint32_t now) const {
    std::string out="{\"mode\":\"";
    out += polling ? "Poll - no dongle" : "Listen - Solar Guardian";
    out += "\",\"values\":[";
    for(size_t i=0;i<COUNT;i++){if(i)out+=",";out+=std::isfinite(values[i])?std::to_string(values[i]):"null";}
    out += "],\"ages\":[";
    for(size_t i=0;i<COUNT;i++){if(i)out+=",";auto a=age(i,now);out+=std::isfinite(a)?std::to_string(a):"null";}
    out += "],\"matched\":"+std::to_string(matched)+",\"orphan\":"+std::to_string(orphan)+",\"exceptions\":"+std::to_string(exceptions)+
      ",\"charge_control\":"+charge_json(now)+"}";
    return out;
  }

  Bus(){values.fill(NAN);}
  static uint16_t crc(const uint8_t *p,size_t n){uint16_t c=0xffff;while(n--){c^=*p++;for(int i=0;i<8;i++)c=(c&1)?(c>>1)^0xa001:c>>1;}return c;}
  static bool valid(const uint8_t *p,size_t n){return n>=4 && crc(p,n-2)==uint16_t(p[n-2]|(p[n-1]<<8));}
  void mode(bool active){
    if(charge_queued_ || (pending_ && fn_==5))charge_command_=CANCELLED;
    charge_queued_=false;polling=active;pending_=false;buf_.clear();next_=0;last_tx_=0;
  }
  float age(size_t f,uint32_t now)const{return revisions[f]?float(uint32_t(now-stamps[f]))/1000.f:NAN;}
  ChargeCommand charge_command()const{return charge_command_;}
  bool request_charge(bool enabled,uint32_t now){
    // No boot writes, no commands in listener mode, and no hidden retry queue.
    if(charge_queued_ || (pending_ && fn_==5))return false;
    ++charge_sequence_;charge_exception_=0;charge_enabled_=enabled;have_charge_request_=true;
    if(!polling){charge_command_=LISTEN_ONLY;return false;}
    charge_requested_at_=now;charge_queued_=true;charge_command_=QUEUED;return true;
  }
  void feed(uint8_t b,uint32_t now){
    if(!buf_.empty() && uint32_t(now-last_byte_)>200){
      buf_.clear();
      // Partial/noisy input must not silently discard a pending write's timeout.
      if(!(pending_ && fn_==5))pending_=false;
    }
    last_byte_=now;
    if(buf_.size()>=260){buf_.clear();if(!(pending_ && fn_==5))pending_=false;}
    buf_.push_back(b);parse(now);
  }
  // Caller writes returned request through UART hardware direction control.
  std::vector<uint8_t> poll(uint32_t now){
    if(!polling)return {};
    if(pending_){
      if(uint32_t(now-request_at_)<=1500)return {};
      if(fn_==5)charge_command_=TIMEOUT;
      pending_=false;
    }
    if(charge_queued_ && uint32_t(now-charge_requested_at_)>5000){
      charge_queued_=false;charge_command_=TIMEOUT;
    }
    if(uint32_t(now-last_tx_)<1000)return {};
    // Do not transmit over a packet that is still arriving.
    if(!buf_.empty()){
      if(uint32_t(now-last_byte_)<=200)return {};
      buf_.clear();
    }
    if(charge_queued_){
      charge_queued_=false;charge_command_=WAITING;
      const uint16_t value=charge_enabled_?0xff00:0x0000;
      std::vector<uint8_t> r={1,5,0,0,uint8_t(value>>8),uint8_t(value)};
      auto c=crc(r.data(),r.size());r.push_back(c&255);r.push_back(c>>8);
      expect(5,0,value,now);last_tx_=now;return r;
    }
    static const uint16_t start[]={0x3100,0x3104,0x3110,0x311a,0x331a,0x331b,0x3201};
    static const uint16_t count[]={4,2,2,1,1,2,1};
    uint16_t a=start[next_],n=count[next_];next_=(next_+1)%7;
    std::vector<uint8_t> r={1,4,uint8_t(a>>8),uint8_t(a),0,uint8_t(n)};
    auto c=crc(r.data(),r.size());r.push_back(c&255);r.push_back(c>>8);
    expect(4,a,n,now);last_tx_=now;return r;
  }
 private:
  std::vector<uint8_t> buf_;
  uint32_t last_byte_=0,request_at_=0,last_tx_=0;
  uint16_t start_=0,count_=0;
  uint8_t fn_=0,next_=0;
  bool pending_=false;
  bool charge_queued_=false,charge_enabled_=false,have_charge_request_=false,have_charge_status_=false;
  uint32_t charge_sequence_=0,charge_requested_at_=0,charge_status_at_=0;
  uint16_t charge_status_=0;
  uint8_t charge_exception_=0;
  ChargeCommand charge_command_=NEVER;
  void expect(uint8_t fn,uint16_t a,uint16_t n,uint32_t now){fn_=fn;start_=a;count_=n;request_at_=now;pending_=true;}
  void set(Field f,float v,uint32_t now){values[f]=v;stamps[f]=now;++revisions[f];}
  void decode(const uint8_t *p,uint32_t now){
    auto has=[&](uint16_t a,unsigned n=1){return a>=start_ && uint32_t(a)+n<=uint32_t(start_)+count_;};
    auto word=[&](uint16_t a)->uint16_t {size_t i=3+2*(a-start_);return uint16_t(p[i]<<8|p[i+1]);};
    if(fn_!=4)return;
    if(has(0x3100))set(PV_V,word(0x3100)*.01f,now);
    if(has(0x3101))set(PV_A,word(0x3101)*.01f,now);
    if(has(0x3102,2))set(PV_W,(uint32_t(word(0x3103))<<16|word(0x3102))*.01f,now);
    if(has(0x3104))set(BAT_V,word(0x3104)*.01f,now);
    if(has(0x3105))set(BAT_A,word(0x3105)*.01f,now);
    if(has(0x3110))set(BAT_T,int16_t(word(0x3110))*.01f,now);
    if(has(0x3111))set(CTRL_T,int16_t(word(0x3111))*.01f,now);
    if(has(0x311a))set(SOC,word(0x311a),now);
    if(has(0x331a))set(BAT_V,word(0x331a)*.01f,now);
    if(has(0x331b))set(CURRENT_LOW,word(0x331b)*.01f,now);
    if(has(0x331b,2))set(BAT_A,int32_t(uint32_t(word(0x331c))<<16|word(0x331b))*.01f,now);
    if(has(0x3201)){charge_status_=word(0x3201);charge_status_at_=now;have_charge_status_=true;}
  }
  void parse(uint32_t now){
    while(buf_.size()>=2){
      if(buf_[0]!=1){buf_.erase(buf_.begin());continue;}
      uint8_t f=buf_[1];
      if(f!=2 && f!=4 && f!=5 && f!=0x82 && f!=0x84 && f!=0x85){
        if(!(pending_ && fn_==5))pending_=false;
        buf_.erase(buf_.begin());continue;
      }
      if(buf_.size()<3)return;
      if(f==5){
        if(buf_.size()<8)return;
        if(!valid(buf_.data(),8)){buf_.erase(buf_.begin());continue;}
        const uint16_t address=uint16_t(buf_[2]<<8|buf_[3]),value=uint16_t(buf_[4]<<8|buf_[5]);
        if(pending_ && fn_==5 && uint32_t(now-request_at_)<=1500 && address==start_ && value==count_){
          charge_command_=ACKNOWLEDGED;pending_=false;++matched;next_=6;
        }else ++orphan;
        buf_.erase(buf_.begin(),buf_.begin()+8);continue;
      }
      size_t n=0;
      if((f==2||f==4) && buf_.size()>=8 && valid(buf_.data(),8)){
        uint16_t a=uint16_t(buf_[2]<<8|buf_[3]),q=uint16_t(buf_[4]<<8|buf_[5]);
        if(q && q<=(f==4?125:2000)){
          if(pending_ && fn_==5)charge_command_=CANCELLED;
          expect(f,a,q,now);n=8;
        }
      }
      if(!n){
        size_t len=(f&0x80)?5:size_t(buf_[2])+5;
        if(len>255 || (!(f&0x80) && (buf_[2]==0 || (f==4 && (buf_[2]&1))))){
          if(buf_.size()<8)return;
          if(!(pending_ && fn_==5))pending_=false;
          buf_.erase(buf_.begin());continue;
        }
        if(buf_.size()<len)return;
        if(!valid(buf_.data(),len)){
          if(buf_.size()<8)return;
          if(!(pending_ && fn_==5))pending_=false;
          buf_.erase(buf_.begin());continue;
        }
        n=len;
        bool fresh=pending_ && uint32_t(now-request_at_)<=1500 && (f&0x7f)==fn_;
        if(f&0x80){
          if(fresh){
            ++exceptions;
            if(fn_==5){charge_command_=REJECTED;charge_exception_=buf_[2];}
            pending_=false;
          }
        }else if(fresh && buf_[2]==(fn_==4?2*count_:(count_+7)/8)){
          decode(buf_.data(),now);++matched;pending_=false;
        }else {
          ++orphan;
          if(!(pending_ && fn_==5))pending_=false;
        }
      }
      buf_.erase(buf_.begin(),buf_.begin()+n);
    }
  }
};
inline Bus &bus(){static Bus b;return b;}
}
