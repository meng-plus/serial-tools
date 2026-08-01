import { computed, onUnmounted, ref, watch, type Ref } from 'vue'

/** Ctrl+滚轮调整视图字号，范围 10–28 */
export function useViewFontSize(
  el: Ref<HTMLElement | null | undefined>,
  initial = 14,
  onChange?: (size: number) => void,
) {
  const fontSize = ref(initial)

  function setFontSize(n: number) {
    const v = Math.min(28, Math.max(10, Math.round(n)))
    if (v === fontSize.value) return
    fontSize.value = v
    onChange?.(v)
  }

  function onWheel(e: WheelEvent) {
    if (!e.ctrlKey) return
    e.preventDefault()
    const delta = e.deltaY > 0 ? -1 : 1
    setFontSize(fontSize.value + delta)
  }

  let attached: HTMLElement | null = null

  function attach(node: HTMLElement | null | undefined) {
    if (attached) {
      attached.removeEventListener('wheel', onWheel)
      attached = null
    }
    if (node) {
      node.addEventListener('wheel', onWheel, { passive: false })
      attached = node
    }
  }

  watch(el, (node) => attach(node), { immediate: true })

  onUnmounted(() => attach(null))

  const style = computed(() => ({ fontSize: `${fontSize.value}px` }))

  return { fontSize, setFontSize, style }
}
