#import "QSTouchInjector.h"

#import <mach/mach_time.h>
#import <objc/runtime.h>

#pragma mark - IOKit private declarations

typedef struct __IOHIDEvent *IOHIDEventRef;
typedef double IOHIDFloat;
typedef UInt32 IOOptionBits;

enum {
  kQSTransducerFinger = 2,
  kQSTransducerHand = 3,
};
enum {
  kQSDigitizerEventRange = 0x1,
  kQSDigitizerEventTouch = 0x2,
  kQSDigitizerEventPosition = 0x4,
};
// (kIOHIDEventTypeDigitizer << 16) + 25
static const uint32_t kQSFieldDigitizerIsDisplayIntegrated = (11 << 16) + 25;

extern IOHIDEventRef IOHIDEventCreateDigitizerEvent(CFAllocatorRef, uint64_t timeStamp, uint32_t type, uint32_t index,
                                                    uint32_t identity, uint32_t eventMask, uint32_t buttonMask,
                                                    IOHIDFloat x, IOHIDFloat y, IOHIDFloat z, IOHIDFloat tipPressure,
                                                    IOHIDFloat barrelPressure, Boolean range, Boolean touch,
                                                    IOOptionBits options);
extern IOHIDEventRef IOHIDEventCreateDigitizerFingerEventWithQuality(
    CFAllocatorRef, uint64_t timeStamp, uint32_t index, uint32_t identity, uint32_t eventMask, IOHIDFloat x, IOHIDFloat y,
    IOHIDFloat z, IOHIDFloat tipPressure, IOHIDFloat twist, IOHIDFloat minorRadius, IOHIDFloat majorRadius,
    IOHIDFloat quality, IOHIDFloat density, IOHIDFloat irregularity, Boolean range, Boolean touch, IOOptionBits options);
extern void IOHIDEventAppendEvent(IOHIDEventRef event, IOHIDEventRef child);
extern void IOHIDEventSetIntegerValue(IOHIDEventRef event, uint32_t field, int value);

#pragma mark - UIKit private declarations

@interface UITouch (QSPrivate)
- (void)setWindow:(UIWindow *)window;
- (void)setView:(UIView *)view;
- (void)setTapCount:(NSUInteger)tapCount;
- (void)setPhase:(UITouchPhase)phase;
- (void)setTimestamp:(NSTimeInterval)timestamp;
- (void)setGestureView:(UIView *)view;
- (void)_setLocationInWindow:(CGPoint)location resetPrevious:(BOOL)resetPrevious;
- (void)_setIsFirstTouchForView:(BOOL)first;
- (void)_setHidEvent:(IOHIDEventRef)event;
@end

@interface UIEvent (QSPrivate)
- (void)_clearTouches;
- (void)_addTouch:(UITouch *)touch forDelayedDelivery:(BOOL)delayed;
- (void)_setHIDEvent:(IOHIDEventRef)event;
@end

@interface UIApplication (QSPrivate)
- (UIEvent *)_touchesEvent;
@end

#pragma mark - Implementation

static UITouch *qsCurrentTouch;

static UIWindow *QSKeyWindow(void) {
  for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
    if (scene.activationState != UISceneActivationStateForegroundActive || ![scene isKindOfClass:UIWindowScene.class]) {
      continue;
    }
    UIWindowScene *ws = (UIWindowScene *)scene;
    if (ws.keyWindow) return ws.keyWindow;
    for (UIWindow *w in ws.windows) {
      if (w.isKeyWindow) return w;
    }
  }
  return nil;
}

static IOHIDEventRef QSCreateHIDEvent(UITouch *touch) {
  uint64_t ts = mach_absolute_time();
  BOOL touching = touch.phase != UITouchPhaseEnded && touch.phase != UITouchPhaseCancelled;
  uint32_t mask = touch.phase == UITouchPhaseMoved ? kQSDigitizerEventPosition
                                                    : (kQSDigitizerEventRange | kQSDigitizerEventTouch);
  IOHIDEventRef hand = IOHIDEventCreateDigitizerEvent(kCFAllocatorDefault, ts, kQSTransducerHand, 0, 0,
                                                      kQSDigitizerEventTouch, 0, 0, 0, 0, 0, 0, false, true, 0);
  IOHIDEventSetIntegerValue(hand, kQSFieldDigitizerIsDisplayIntegrated, 1);
  CGPoint p = [touch locationInView:touch.window];
  IOHIDEventRef finger = IOHIDEventCreateDigitizerFingerEventWithQuality(
      kCFAllocatorDefault, ts, 1, 2, mask, p.x, p.y, 0, 0, 0, 5, 5, 1, 1, 1, touching, touching, 0);
  IOHIDEventSetIntegerValue(finger, kQSFieldDigitizerIsDisplayIntegrated, 1);
  IOHIDEventAppendEvent(hand, finger);
  CFRelease(finger);
  return hand;
}

static void QSSend(UITouch *touch) {
  [touch setTimestamp:NSProcessInfo.processInfo.systemUptime];
  IOHIDEventRef hid = QSCreateHIDEvent(touch);
  [touch _setHidEvent:hid];
  UIEvent *event = [UIApplication.sharedApplication _touchesEvent];
  [event _clearTouches];
  [event _setHIDEvent:hid];
  [event _addTouch:touch forDelayedDelivery:NO];
  CFRelease(hid);
  [UIApplication.sharedApplication sendEvent:event];
}

@implementation QSTouchInjector

+ (NSString *)touchDownAtPoint:(CGPoint)point {
  UIWindow *window = QSKeyWindow();
  if (!window) return nil;
  UIView *hit = [window hitTest:point withEvent:nil];

  UITouch *touch = [[UITouch alloc] init];
  [touch setWindow:window];  // must be first: resets other state
  [touch setTapCount:1];
  [touch _setLocationInWindow:point resetPrevious:YES];
  [touch setView:hit];
  [touch setPhase:UITouchPhaseBegan];
  if ([touch respondsToSelector:@selector(setGestureView:)]) [touch setGestureView:hit];
  if ([touch respondsToSelector:@selector(_setIsFirstTouchForView:)]) [touch _setIsFirstTouchForView:YES];
  qsCurrentTouch = touch;
  QSSend(touch);
  return [NSString stringWithFormat:@"%@ in %@", NSStringFromClass(hit.class), NSStringFromClass(window.class)];
}

+ (BOOL)touchUp {
  UITouch *touch = qsCurrentTouch;
  if (!touch) return NO;
  [touch setPhase:UITouchPhaseEnded];
  QSSend(touch);
  qsCurrentTouch = nil;
  return YES;
}

@end
