#import "QSTouchInjector.h"

#import <mach/mach_time.h>

// Independent implementation of the approach used by KIF (kif-framework/KIF, Apache-2.0):
// a UITouch with private setters, attached to the application's touches event together with an
// IOHIDEvent, then delivered with -[UIApplication sendEvent:].

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
/** Multi-finger state: a UITouch or NSNull per finger. */
static NSMutableArray *qsFingers;

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

/**
 * One HID hand event with a finger child per touch (index i+1, identity i+2), like a real multi-finger
 * report: began / ended fingers carry range + touch, moved ones position.
 */
static IOHIDEventRef QSCreateMultiHIDEvent(NSArray<UITouch *> *touches, NSArray<NSNumber *> *indexes) {
  uint64_t ts = mach_absolute_time();
  BOOL any = NO;
  for (UITouch *t in touches) any = any || (t.phase != UITouchPhaseEnded && t.phase != UITouchPhaseCancelled);
  IOHIDEventRef hand = IOHIDEventCreateDigitizerEvent(kCFAllocatorDefault, ts, kQSTransducerHand, 0, 0,
                                                      kQSDigitizerEventTouch, 0, 0, 0, 0, 0, 0, false, any, 0);
  IOHIDEventSetIntegerValue(hand, kQSFieldDigitizerIsDisplayIntegrated, 1);
  for (NSUInteger k = 0; k < touches.count; k++) {
    UITouch *touch = touches[k];
    uint32_t i = (uint32_t)indexes[k].unsignedIntegerValue;
    BOOL touching = touch.phase != UITouchPhaseEnded && touch.phase != UITouchPhaseCancelled;
    uint32_t mask = touch.phase == UITouchPhaseMoved      ? kQSDigitizerEventPosition
                    : touch.phase == UITouchPhaseStationary ? 0
                                                            : (kQSDigitizerEventRange | kQSDigitizerEventTouch);
    CGPoint p = [touch locationInView:touch.window];
    IOHIDEventRef finger = IOHIDEventCreateDigitizerFingerEventWithQuality(
        kCFAllocatorDefault, ts, i + 1, i + 2, mask, p.x, p.y, 0, 0, 0, 5, 5, 1, 1, 1, touching, touching, 0);
    IOHIDEventSetIntegerValue(finger, kQSFieldDigitizerIsDisplayIntegrated, 1);
    IOHIDEventAppendEvent(hand, finger);
    CFRelease(finger);
  }
  return hand;
}

static void QSSendMany(NSArray<UITouch *> *touches, NSArray<NSNumber *> *indexes) {
  NSTimeInterval now = NSProcessInfo.processInfo.systemUptime;
  for (UITouch *t in touches) [t setTimestamp:now];
  IOHIDEventRef hid = QSCreateMultiHIDEvent(touches, indexes);
  UIEvent *event = [UIApplication.sharedApplication _touchesEvent];
  [event _clearTouches];
  [event _setHIDEvent:hid];
  for (UITouch *t in touches) {
    [t _setHidEvent:hid];
    [event _addTouch:t forDelayedDelivery:NO];
  }
  CFRelease(hid);
  [UIApplication.sharedApplication sendEvent:event];
}

@implementation QSTouchInjector

+ (NSString *)missingPrivateAPI {
  UITouch *touch = [UITouch new];
  for (NSString *name in @[ @"setWindow:", @"setView:", @"setTapCount:", @"setPhase:", @"setTimestamp:",
                            @"_setLocationInWindow:resetPrevious:", @"_setHidEvent:" ]) {
    if (![touch respondsToSelector:NSSelectorFromString(name)]) return [@"UITouch " stringByAppendingString:name];
  }
  if (![UIApplication.sharedApplication respondsToSelector:@selector(_touchesEvent)]) return @"UIApplication _touchesEvent";
  UIEvent *event = [UIApplication.sharedApplication _touchesEvent];
  for (NSString *name in @[ @"_clearTouches", @"_addTouch:forDelayedDelivery:", @"_setHIDEvent:" ]) {
    if (![event respondsToSelector:NSSelectorFromString(name)]) return [@"UIEvent " stringByAppendingString:name];
  }
  return nil;
}

+ (NSArray<UIWindowScene *> *)foregroundScenes {
  NSMutableArray *out = [NSMutableArray array];
  for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
    if (scene.activationState == UISceneActivationStateForegroundActive && [scene isKindOfClass:UIWindowScene.class]) {
      [out addObject:scene];
    }
  }
  return out;
}

+ (UIWindow *)keyWindow {
  for (UIWindowScene *ws in [self foregroundScenes]) {
    if (ws.keyWindow) return ws.keyWindow;
    for (UIWindow *w in ws.windows) {
      if (w.isKeyWindow) return w;
    }
  }
  return nil;
}

+ (NSArray<UIWindow *> *)windows {
  NSMutableArray<UIWindow *> *out = [NSMutableArray array];
  for (UIWindowScene *ws in [self foregroundScenes]) {
    for (UIWindow *w in ws.windows) {
      if (!w.hidden && w.alpha > 0) [out addObject:w];
    }
  }
  [out sortUsingComparator:^NSComparisonResult(UIWindow *a, UIWindow *b) {
    return a.windowLevel < b.windowLevel ? NSOrderedAscending : a.windowLevel > b.windowLevel ? NSOrderedDescending : NSOrderedSame;
  }];
  return out;
}

+ (UIView *)viewWithReactTag:(NSInteger)tag {
  if (tag <= 0) return nil;
  Protocol *componentView = NSProtocolFromString(@"RCTComponentViewProtocol");
  for (UIWindow *w in [[self windows] reverseObjectEnumerator]) {
    UIView *v = [w viewWithTag:tag];
    if (v && (componentView == nil || [v conformsToProtocol:componentView])) return v;
  }
  return nil;
}

+ (UIView *)touchDownAt:(CGPoint)point inWindow:(UIWindow *)window tapCount:(NSUInteger)tapCount {
  UIView *hit = [window hitTest:point withEvent:nil];
  UITouch *touch = [[UITouch alloc] init];
  [touch setWindow:window];  // must be first: resets the other fields
  [touch setTapCount:tapCount];
  [touch _setLocationInWindow:point resetPrevious:YES];
  [touch setView:hit];
  [touch setPhase:UITouchPhaseBegan];
  if ([touch respondsToSelector:@selector(setGestureView:)]) [touch setGestureView:hit];
  if ([touch respondsToSelector:@selector(_setIsFirstTouchForView:)]) [touch _setIsFirstTouchForView:YES];
  qsCurrentTouch = touch;
  QSSend(touch);
  return hit;
}

+ (BOOL)touchMoveTo:(CGPoint)point {
  UITouch *touch = qsCurrentTouch;
  if (!touch) return NO;
  [touch _setLocationInWindow:point resetPrevious:NO];
  [touch setPhase:UITouchPhaseMoved];
  QSSend(touch);
  return YES;
}

+ (BOOL)touchUp {
  UITouch *touch = qsCurrentTouch;
  if (!touch) return NO;
  [touch setPhase:UITouchPhaseEnded];
  QSSend(touch);
  qsCurrentTouch = nil;
  return YES;
}

+ (BOOL)sendFingers:(NSArray *)points inWindow:(UIWindow *)window {
  if (qsFingers == nil) qsFingers = [NSMutableArray array];
  while (qsFingers.count < points.count) [qsFingers addObject:NSNull.null];
  NSMutableArray<UITouch *> *touches = [NSMutableArray array];
  NSMutableArray<NSNumber *> *indexes = [NSMutableArray array];
  NSMutableIndexSet *lifted = [NSMutableIndexSet indexSet];
  BOOL changed = NO;
  for (NSUInteger i = 0; i < qsFingers.count; i++) {
    id p = i < points.count ? points[i] : NSNull.null;
    id current = qsFingers[i];
    BOOL down = [p isKindOfClass:NSValue.class];
    if (down && current == NSNull.null) {
      CGPoint point = [(NSValue *)p CGPointValue];
      UIView *hit = [window hitTest:point withEvent:nil];
      UITouch *touch = [[UITouch alloc] init];
      [touch setWindow:window];  // must be first: resets the other fields
      [touch setTapCount:1];
      [touch _setLocationInWindow:point resetPrevious:YES];
      [touch setView:hit];
      [touch setPhase:UITouchPhaseBegan];
      if ([touch respondsToSelector:@selector(setGestureView:)]) [touch setGestureView:hit];
      if ([touch respondsToSelector:@selector(_setIsFirstTouchForView:)]) [touch _setIsFirstTouchForView:YES];
      qsFingers[i] = touch;
      changed = YES;
    } else if (down) {
      UITouch *touch = current;
      CGPoint point = [(NSValue *)p CGPointValue];
      CGPoint before = [touch locationInView:touch.window];
      if (CGPointEqualToPoint(before, point)) {
        [touch setPhase:UITouchPhaseStationary];
      } else {
        [touch _setLocationInWindow:point resetPrevious:NO];
        [touch setPhase:UITouchPhaseMoved];
        changed = YES;
      }
    } else if (current != NSNull.null) {
      [(UITouch *)current setPhase:UITouchPhaseEnded];
      [lifted addIndex:i];
      changed = YES;
    }
    if (qsFingers[i] != NSNull.null) {
      [touches addObject:qsFingers[i]];
      [indexes addObject:@(i)];
    }
  }
  if (changed && touches.count > 0) QSSendMany(touches, indexes);
  [lifted enumerateIndexesUsingBlock:^(NSUInteger i, BOOL *stop) { qsFingers[i] = NSNull.null; }];
  return changed;
}

+ (void)liftAllFingers {
  if (qsFingers == nil) return;
  NSMutableArray *none = [NSMutableArray array];
  for (NSUInteger i = 0; i < qsFingers.count; i++) [none addObject:NSNull.null];
  UIWindow *window = nil;
  for (id t in qsFingers) if (t != NSNull.null) window = ((UITouch *)t).window;
  if (window) [self sendFingers:none inWindow:window];
  [qsFingers removeAllObjects];
}

@end
