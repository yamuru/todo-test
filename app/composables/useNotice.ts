export function useNotice() {
  return useState<string>('notice', () => '')
}
