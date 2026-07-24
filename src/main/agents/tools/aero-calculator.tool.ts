import { DynamicTool } from '@langchain/core/tools'

interface AeroParams {
  formula: string
  params: Record<string, number>
}

function computeAero(formula: string, params: Record<string, number>): string {
  switch (formula) {
    case 'lift': {
      // L = 0.5 * rho * V^2 * S * CL
      const { rho = 1.225, V, S, CL } = params
      if (V === undefined || S === undefined || CL === undefined) {
        return '缺少必要参数: 升力计算需要 V(速度,m/s), S(参考面积,m²), CL(升力系数)，可选 rho(空气密度,kg/m³，默认1.225)'
      }
      const L = 0.5 * rho * V * V * S * CL
      return `升力 L = 0.5 × ${rho} × ${V}² × ${S} × ${CL} = ${L.toFixed(4)} N`
    }
    case 'drag': {
      // D = 0.5 * rho * V^2 * S * CD
      const { rho: rhoD = 1.225, V: VD, S: SD, CD } = params
      if (VD === undefined || SD === undefined || CD === undefined) {
        return '缺少必要参数: 阻力计算需要 V(速度,m/s), S(参考面积,m²), CD(阻力系数)，可选 rho(空气密度,kg/m³，默认1.225)'
      }
      const D = 0.5 * rhoD * VD * VD * SD * CD
      return `阻力 D = 0.5 × ${rhoD} × ${VD}² × ${SD} × ${CD} = ${D.toFixed(4)} N`
    }
    case 'reynolds': {
      // Re = rho * V * L_char / mu
      const { rho: rhoR = 1.225, V: VR, L_char, mu = 1.789e-5 } = params
      if (VR === undefined || L_char === undefined) {
        return '缺少必要参数: 雷诺数计算需要 V(速度,m/s), L_char(特征长度,m)，可选 rho(空气密度,默认1.225), mu(动力粘度,默认1.789e-5 Pa·s)'
      }
      const Re = rhoR * VR * L_char / mu
      return `雷诺数 Re = ${rhoR} × ${VR} × ${L_char} / ${mu} = ${Re.toExponential(4)}`
    }
    case 'mach': {
      // M = V / a
      const { V: VM, a = 340.3 } = params
      if (VM === undefined) {
        return '缺少必要参数: 马赫数计算需要 V(速度,m/s)，可选 a(音速,m/s，默认340.3)'
      }
      const M = VM / a
      return `马赫数 M = ${VM} / ${a} = ${M.toFixed(6)}`
    }
    case 'dynamic_pressure': {
      // q = 0.5 * rho * V^2
      const { rho: rhoQ = 1.225, V: VQ } = params
      if (VQ === undefined) {
        return '缺少必要参数: 动压计算需要 V(速度,m/s)，可选 rho(空气密度,默认1.225)'
      }
      const q = 0.5 * rhoQ * VQ * VQ
      return `动压 q = 0.5 × ${rhoQ} × ${VQ}² = ${q.toFixed(4)} Pa`
    }
    case 'lift_to_drag': {
      // L/D = CL / CD
      const { CL: CLLD, CD: CDLD } = params
      if (CLLD === undefined || CDLD === undefined || CDLD === 0) {
        return '缺少必要参数: 升阻比计算需要 CL(升力系数)和 CD(阻力系数)，且 CD 不能为0'
      }
      const LD = CLLD / CDLD
      return `升阻比 L/D = ${CLLD} / ${CDLD} = ${LD.toFixed(4)}`
    }
    case 'wing_loading': {
      // W/S = W / S
      const { W, S: WS } = params
      if (W === undefined || WS === undefined) {
        return '缺少必要参数: 翼载荷计算需要 W(重量,N)和 S(参考面积,m²)'
      }
      const WS_ratio = W / WS
      return `翼载荷 W/S = ${W} / ${WS} = ${WS_ratio.toFixed(4)} N/m²`
    }
    default:
      return `未知公式: ${formula}。支持的公式: lift, drag, reynolds, mach, dynamic_pressure, lift_to_drag, wing_loading`
  }
}

export const aeroCalculatorTool = new DynamicTool({
  name: 'aero_calculator',
  description: `航空气动力学专用计算器。输入JSON格式参数，包含 formula 和 params 字段。
支持的公式:
- lift: 升力 L = 0.5×ρ×V²×S×CL (参数: V, S, CL, 可选rho)
- drag: 阻力 D = 0.5×ρ×V²×S×CD (参数: V, S, CD, 可选rho)
- reynolds: 雷诺数 Re = ρ×V×L/μ (参数: V, L_char, 可选rho, mu)
- mach: 马赫数 M = V/a (参数: V, 可选a)
- dynamic_pressure: 动压 q = 0.5×ρ×V² (参数: V, 可选rho)
- lift_to_drag: 升阻比 L/D = CL/CD (参数: CL, CD)
- wing_loading: 翼载荷 W/S (参数: W, S)

示例输入: {"formula":"lift","params":{"V":70,"S":20,"CL":0.5}}`,
  func: async (input: string): Promise<string> => {
    try {
      const parsed: AeroParams = JSON.parse(input.trim())
      if (!parsed.formula || !parsed.params) {
        return '输入格式错误: 需要 formula 和 params 字段'
      }
      return computeAero(parsed.formula, parsed.params)
    } catch (err: any) {
      return `解析错误: 请提供有效的JSON输入。${err.message || String(err)}`
    }
  }
})
