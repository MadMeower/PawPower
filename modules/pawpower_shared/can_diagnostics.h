#pragma once
#include <string>
#include <cstdint>
namespace paw {
// Link/transport diagnostics only. These are not 6000XP internal fault registers.
inline uint8_t can_fault_code(const std::string &s) {
 if(s=="CAN initialization failed")return 1;
 if(s=="CAN status error")return 2;
 if(s=="CAN bus-off; recovering")return 3;
 if(s=="CAN start failed")return 4;
 if(s=="CAN transmit backlog; retrying fresh next cycle")return 5;
 if(s=="CAN transmit error; retrying fresh next cycle")return 6;
 if(s=="CAN transmit failure; check peer and termination")return 7;
 return 0;
}
}
