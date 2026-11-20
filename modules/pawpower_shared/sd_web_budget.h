#pragma once
#include <cstddef>
#include <string_view>
namespace paw {
// REST text sensors contain two escaped copies of the state, plus metadata.
// ESPHome's current serializer truncates at 5120 bytes. Leave ample headroom.
constexpr size_t sd_web_string_size(std::string_view text) {
  size_t size=2;
  for(unsigned char c:text)size+=c<32?6:(c=='"'||c=='\\'?2:1);
  return size;
}
constexpr bool sd_web_snapshot_fits(std::string_view snapshot) {
  return sd_web_string_size(snapshot)<=2000;
}
inline constexpr size_t SD_EXPORT_CHUNK_BYTES=1024;
}
