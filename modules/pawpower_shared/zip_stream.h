#pragma once
// Streaming ZIP method 8, RFC 1951 fixed-Huffman DEFLATE with bounded LZ77.
// 4 KiB independent dictionary blocks bound RAM and work between yield points.
#include <algorithm>
#include <array>
#include <cstdint>
#include <cstring>
#include <cstdio>
#include <cstdlib>
#include <functional>
#include <string>
#include <vector>

namespace paw {
class ZipStream {
 public:
  using Sink=std::function<bool(const uint8_t*,size_t)>;
  explicit ZipStream(Sink sink):sink_(sink){}
  template<class Reader,class Pump> bool add(const std::string &name,uint32_t size,Reader read,Pump pump){
    if(!good_ || entries_.size()>=64 || name.size()>100)return false;
    Entry e{name,offset_,0,0,size};
    std::vector<uint8_t> h;u32(h,0x04034b50);u16(h,20);u16(h,0x808);u16(h,8);u16(h,0);u16(h,33);
    u32(h,0);u32(h,0);u32(h,0);u16(h,name.size());u16(h,0);h.insert(h.end(),name.begin(),name.end());
    if(!write(h.data(),h.size()))return false;
    uint32_t crc=0xffffffff,remaining=size;const uint32_t beginning=offset_;
    bits_=0;bit_count_=0;used_=0;
    do {
      const size_t count=std::min<uint32_t>(remaining,input_.size());
      if(count && read(input_.data(),count)!=int(count))return good_=false;
      for(size_t i=0;i<count;++i){crc^=input_[i];for(int j=0;j<8;++j)crc=(crc>>1)^((crc&1)?0xedb88320U:0);}
      remaining-=count;
      block(count,remaining==0);
      if(!flush() || !pump())return good_=false;
    }while(remaining && good_);
    if(bit_count_){byte(uint8_t(bits_));bits_=0;bit_count_=0;}
    if(!flush())return false;
    e.compressed=offset_-beginning;e.crc=crc^0xffffffff;
    std::vector<uint8_t> descriptor;u32(descriptor,0x08074b50);u32(descriptor,e.crc);u32(descriptor,e.compressed);u32(descriptor,size);
    if(!write(descriptor.data(),descriptor.size()))return false;
    entries_.push_back(e);return true;
  }
  bool finish(){
    if(!good_)return false;const uint32_t start=offset_;
    for(const auto &e:entries_){
      std::vector<uint8_t> h;u32(h,0x02014b50);u16(h,20);u16(h,20);u16(h,0x808);u16(h,8);u16(h,0);u16(h,33);
      u32(h,e.crc);u32(h,e.compressed);u32(h,e.size);u16(h,e.name.size());u16(h,0);u16(h,0);u16(h,0);u16(h,0);u32(h,0);u32(h,e.offset);
      h.insert(h.end(),e.name.begin(),e.name.end());if(!write(h.data(),h.size()))return false;
    }
    const uint32_t size=offset_-start;std::vector<uint8_t> h;u32(h,0x06054b50);u16(h,0);u16(h,0);
    u16(h,entries_.size());u16(h,entries_.size());u32(h,size);u32(h,start);u16(h,0);
    return write(h.data(),h.size());
  }
 private:
  struct Entry{std::string name;uint32_t offset,crc,compressed,size;};
  static void u16(std::vector<uint8_t>&v,uint32_t x){v.push_back(x);v.push_back(x>>8);}
  static void u32(std::vector<uint8_t>&v,uint32_t x){u16(v,x);u16(v,x>>16);}
  bool write(const uint8_t *p,size_t n){if(!good_)return false;if(!sink_(p,n))return good_=false;offset_+=n;return true;}
  bool flush(){if(used_){const bool ok=write(output_.data(),used_);used_=0;return ok;}return good_;}
  void byte(uint8_t b){if(!good_)return;output_[used_++]=b;if(used_==output_.size())flush();}
  void put(uint32_t value,unsigned count){bits_|=value<<bit_count_;bit_count_+=count;while(bit_count_>=8){byte(bits_&255);bits_>>=8;bit_count_-=8;}}
  static uint32_t reversed(uint32_t x,unsigned n){uint32_t out=0;while(n--){out=(out<<1)|(x&1);x>>=1;}return out;}
  void symbol(unsigned s){
    if(s<=143)put(reversed(0x30+s,8),8);
    else if(s<=255)put(reversed(0x190+s-144,9),9);
    else if(s<=279)put(reversed(s-256,7),7);
    else put(reversed(0xc0+s-280,8),8);
  }
  unsigned hash(size_t i)const{return ((unsigned(input_[i])*251+input_[i+1])*251+input_[i+2])&4095;}
  void insert(size_t i,size_t n){if(i+2<n){const auto h=hash(i);previous_[i]=head_[h];head_[h]=int16_t(i);}}
  void match(unsigned length,unsigned distance){
    static constexpr unsigned lengths[]={3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258};
    static constexpr unsigned extra[]={0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0};
    static constexpr unsigned distances[]={1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073};
    unsigned code=0;while(code<28 && lengths[code+1]<=length)++code;
    symbol(257+code);put(length-lengths[code],extra[code]);
    code=0;while(code<23 && distances[code+1]<=distance)++code;
    put(reversed(code,5),5);put(distance-distances[code],code<4?0:(code/2-1));
  }
  void block(size_t n,bool final){
    put(final?1:0,1);put(1,2);head_.fill(-1);previous_.fill(-1);
    for(size_t i=0;i<n && good_;){
      unsigned best=0,dist=0;
      if(i+2<n){
        int candidate=head_[hash(i)];unsigned attempts=0;
        while(candidate>=0 && attempts++<24){
          unsigned len=0;while(len<258 && i+len<n && input_[candidate+len]==input_[i+len])++len;
          if(len>best && len>=3){best=len;dist=i-candidate;if(len==258)break;}
          candidate=previous_[candidate];
        }
      }
      if(best>=3){match(best,dist);for(unsigned j=0;j<best;++j)insert(i+j,n);i+=best;}
      else {symbol(input_[i]);insert(i,n);++i;}
    }
    symbol(256);
  }
  Sink sink_;bool good_=true;uint32_t offset_=0,bits_=0;unsigned bit_count_=0;size_t used_=0;
  std::array<uint8_t,4096> input_{};
  std::array<int16_t,4096> head_{},previous_{};
  std::array<uint8_t,1024> output_{};
  std::vector<Entry> entries_;
};
inline bool backup_date_valid(const std::string &d){
  if(d.size()!=10 || d[4]!='-' || d[7]!='-')return false;
  for(size_t i=0;i<10;++i)if(i!=4 && i!=7 && (d[i]<'0'||d[i]>'9'))return false;
  const int y=std::atoi(d.substr(0,4).c_str()),m=std::atoi(d.substr(5,2).c_str()),day=std::atoi(d.substr(8,2).c_str());
  static constexpr int days[]={31,28,31,30,31,30,31,31,30,31,30,31};
  return y>=2020 && y<=2100 && m>=1 && m<=12 && day>=1 && day<=days[m-1]+(m==2 && y%4==0 && (y%100!=0 || y%400==0));
}
inline std::string backup_next_date(std::string d){
  int y=std::atoi(d.substr(0,4).c_str()),m=std::atoi(d.substr(5,2).c_str()),day=std::atoi(d.substr(8,2).c_str())+1;
  // Three unrestricted signed ints can require 36 bytes including separators and NUL.
  char out[40];std::snprintf(out,sizeof(out),"%04d-%02d-%02d",y,m,day);
  if(!backup_date_valid(out)){day=1;if(++m>12){m=1;++y;}std::snprintf(out,sizeof(out),"%04d-%02d-%02d",y,m,day);}
  return out;
}
inline bool backup_range_valid(const std::string &from,const std::string &to){
  if(!backup_date_valid(from)||!backup_date_valid(to)||from>to)return false;
  auto d=from;for(int i=0;i<31;++i){if(d==to)return true;d=backup_next_date(d);}return false;
}
} // namespace paw
