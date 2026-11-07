// Phase 0 / S4 spike: synthesize UITouch/UIEvent (private UIKit + IOKit APIs).
// E2E builds only. Approach modelled on KIF (kif-framework/KIF, Apache-2.0); this is an independent implementation.
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@interface QSTouchInjector : NSObject
/// Phase began at a window point (pt). Returns a description of the hit view, or nil if no window.
+ (nullable NSString *)touchDownAtPoint:(CGPoint)point;
/// Phase ended at the same point as the last touchDown.
+ (BOOL)touchUp;
@end

NS_ASSUME_NONNULL_END
