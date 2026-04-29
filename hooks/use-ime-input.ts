import { useEffect, useRef, useState } from "react"

/**
 * 處理中文（及其他 CJK）輸入法組合輸入問題。
 * 行動裝置上 onChange 會在 compositionEnd 之前多次觸發，
 * 導致搜尋反覆跳動（例如「明ㄏㄜ → 明 → 明ㄏㄜ」）。
 *
 * 用法：
 *   const searchProps = useImeInput(searchText, setSearchText)
 *   <Input {...searchProps} />
 *
 * 清除按鈕只需呼叫原本的 setter：
 *   onClick={() => setSearchText("")}
 */
export function useImeInput(value: string, onChange: (value: string) => void) {
  const [localValue, setLocalValue] = useState(value)
  const isComposing = useRef(false)

  // 當外部 value 改變（例如清除按鈕）時同步本地顯示值
  useEffect(() => {
    if (!isComposing.current) {
      setLocalValue(value)
    }
  }, [value])

  return {
    value: localValue,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      setLocalValue(e.target.value)
      // 組合輸入中不觸發外部 onChange，等 compositionEnd 再更新
      if (!isComposing.current) {
        onChange(e.target.value)
      }
    },
    onCompositionStart: () => {
      isComposing.current = true
    },
    onCompositionEnd: (e: React.CompositionEvent<HTMLInputElement>) => {
      isComposing.current = false
      const val = (e.target as HTMLInputElement).value
      setLocalValue(val)
      onChange(val)
    },
  }
}
