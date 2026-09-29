declare module 'javascript-lp-solver' {
  export interface Model {
    optimize: string
    opType: 'min' | 'max'
    constraints: Record<string, Record<string, number>>
    variables: Record<string, Record<string, number>>
    ints?: Record<string, number>
  }

  export interface Solution {
    feasible: boolean
    bounded?: boolean
    result: number
    [key: string]: number | boolean | undefined
  }

  export function Solve(model: Model): Solution

  const solver: {
    Solve: typeof Solve
  }

  export default solver
}
