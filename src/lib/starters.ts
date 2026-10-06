export type Lang = 'c' | 'python'
export const STARTERS: Record<Lang, string> = {
  c: `#include <stdio.h>

int main(void) {
    // Read input with scanf, print the answer with printf
    return 0;
}
`,
  python: `# Read input with input(), print the answer with print()
`,
}
export const LANG_LABEL: Record<Lang, string> = { c: 'C', python: 'Python 3' }
