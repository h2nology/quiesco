#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * Synthesized UITouch / UIEvent injection inside the app process (docs/spikes/04-ios-touch.md).
 * Uses private UIKit / IOKit API: e2e builds only. All methods must be called on the main thread.
 * Points are in the coordinate space of `window`.
 */
@interface QSTouchInjector : NSObject

/** nil when every private selector this class relies on is available, else the first missing one. */
+ (nullable NSString *)missingPrivateAPI;

/** Foreground key window of the active scene. */
+ (nullable UIWindow *)keyWindow;

/** All visible windows of the foreground scenes, front-most last. */
+ (NSArray<UIWindow *> *)windows;

/** The mounted React component view with this tag (Fabric sets `UIView.tag` to the React tag). */
+ (nullable UIView *)viewWithReactTag:(NSInteger)tag;

/** Begin a touch. Returns the hit-tested view, or nil when there is no window. */
+ (nullable UIView *)touchDownAt:(CGPoint)point inWindow:(UIWindow *)window tapCount:(NSUInteger)tapCount;
/** Move the current touch. */
+ (BOOL)touchMoveTo:(CGPoint)point;
/** End the current touch. */
+ (BOOL)touchUp;

@end

NS_ASSUME_NONNULL_END
