/**
 * 弹窗 / 抽屉打开时锁住背景滚动。
 * 用 overflow:hidden + 滚动条宽度补偿，保留当前 scrollY，关闭时复原并回到原位置。
 * 支持嵌套调用（弹窗与抽屉同时打开时只有一个实际锁）。
 */
let lockCount = 0;
let savedScrollY = 0;
let saved: { bodyOverflow: string; bodyPaddingRight: string } | null = null;

export function lockBodyScroll(): () => void {
  if (lockCount === 0) {
    savedScrollY = window.scrollY;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    const body = document.body;
    saved = {
      bodyOverflow: body.style.overflow,
      bodyPaddingRight: body.style.paddingRight,
    };
    // 只锁 body：body 的 overflow 会传给视口，能阻止滚动，同时保留当前 scrollY
    body.style.overflow = 'hidden';
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
  }
  lockCount += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount > 0 || !saved) return;
    const body = document.body;
    body.style.overflow = saved.bodyOverflow;
    body.style.paddingRight = saved.bodyPaddingRight;
    saved = null;
    if (window.scrollY !== savedScrollY) window.scrollTo(0, savedScrollY);
  };
}
