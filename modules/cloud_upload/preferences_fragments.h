#pragma once
#include <string>
#include <cstdint>
namespace pawcloud {
// Loop-owned bounded assembly. One complete settings update reaches the worker.
class PreferencesFragments {
 public:
  enum Result { DIRECT, PARTIAL, READY, INVALID };
  Result accept(const std::string &packet, int64_t now_us) {
    if(packet.empty() || packet[0]!='@')return DIRECT;
    if(packet.size()<24 || packet[17]!=':' || packet[20]!=':' || packet[23]!=':')return fail();
    for(size_t k=1;k<17;++k)if(!((packet[k]>='0'&&packet[k]<='9')||(packet[k]>='a'&&packet[k]<='f')))return fail();
    for(size_t k : {18U,19U,21U,22U})if(packet[k]<'0'||packet[k]>'9')return fail();
    const unsigned index=(packet[18]-'0')*10+packet[19]-'0';
    const unsigned count=(packet[21]-'0')*10+packet[22]-'0';
    if(count<1 || count>16 || index>=count || packet.size()>104)return fail();
    const auto key=packet.substr(1,16);
    if(index==0){body_.clear();key_=key;next_=0;count_=count;started_=now_us;}
    if(key!=key_ || index!=next_ || count!=count_ || now_us<started_ || now_us-started_>30000000LL)return fail();
    if(body_.size()+packet.size()-24>1024)return fail();
    body_.append(packet,24,std::string::npos);++next_;
    if(next_==count_){key_.clear();return READY;}
    return PARTIAL;
  }
  const std::string &body()const{return body_;}
  void clear(){body_.clear();key_.clear();next_=count_=0;}
 private:
  Result fail(){clear();return INVALID;}
  std::string body_,key_;
  unsigned next_=0,count_=0;
  int64_t started_=0;
};
}
