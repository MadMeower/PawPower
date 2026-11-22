#include "../pawpower_shared/can_tx_cycle.h"
constexpr bool receipt_checks(){
 paw::CanBatchReceipt r;
 if(r.check(0,0,0)!=paw::CanBatchReceipt::NONE)return false;
 r.queued(10,20);
 if(r.check(7,10,20)!=paw::CanBatchReceipt::PENDING)return false;
 if(r.check(0,10,20)!=paw::CanBatchReceipt::COMPLETE)return false;
 if(r.check(0,10,20)!=paw::CanBatchReceipt::NONE)return false;
 r.queued(10,20);if(r.check(0,11,20)!=paw::CanBatchReceipt::FAILED)return false;
 r.queued(10,20);if(r.check(0,10,21)!=paw::CanBatchReceipt::FAILED)return false;
 r.queued(0xffffffffU,20);if(r.check(0,0,20)!=paw::CanBatchReceipt::FAILED)return false;
 r.queued(10,20);r.cancel();return r.check(0,10,20)==paw::CanBatchReceipt::NONE;
}
static_assert(receipt_checks(),"No success before driver completion or after errors, wrap or cancellation");
constexpr bool recovery_checks(){
 paw::CanTxHealth h;h.failed();for(int i=0;i<10;++i)h.completed(140,0);
 if(!h.fault())return false;
 for(int i=0;i<4;++i)h.completed(0,0);if(!h.fault())return false;
 h.completed(0,0);return !h.fault();
}
static_assert(recovery_checks(),"Keep recovery criteria while restoring the original sender");
