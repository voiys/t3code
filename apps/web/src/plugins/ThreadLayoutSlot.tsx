import type { ThreadLayoutWrapperProps } from "./types";
import { useThreadLayoutWrappers } from "./host";

/**
 * Renders any active thread-layout plugin wrappers around a thread view.
 * When no layout plugin is enabled, passes `children` straight through.
 */
export function ThreadLayoutSlot({ mainRef, hidden, children }: ThreadLayoutWrapperProps) {
  const wrappers = useThreadLayoutWrappers();
  let content = children;
  for (let index = wrappers.length - 1; index >= 0; index -= 1) {
    const Wrapper = wrappers[index]!;
    content = (
      <Wrapper mainRef={mainRef} hidden={hidden}>
        {content}
      </Wrapper>
    );
  }
  return <>{content}</>;
}
