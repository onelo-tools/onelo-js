import { OneloError } from './types'

export interface HttpResponse {
  status: number
  json: unknown
}

export async function httpGet(url: string, headers?: Record<string, string>): Promise<HttpResponse> {
  let res: Response
  try {
    res = await fetch(url, { headers })
  } catch (e) {
    throw OneloError.network(e instanceof Error ? e.message : 'fetch failed')
  }
  const json = await parseJson(res)
  return { status: res.status, json }
}

export async function httpPost(
  url: string,
  body: unknown,
  headers?: Record<string, string>
): Promise<HttpResponse> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  } catch (e) {
    throw OneloError.network(e instanceof Error ? e.message : 'fetch failed')
  }
  const json = await parseJson(res)
  return { status: res.status, json }
}

async function parseJson(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    throw OneloError.network('Invalid JSON response')
  }
}

export function checkHostedFlowRequired(json: unknown): void {
  const j = json as Record<string, unknown>
  const errorCode =
    (j['error'] as string | undefined) ??
    ((j['detail'] as Record<string, unknown> | undefined)?.['error'] as string | undefined)
  if (errorCode === 'hosted_flow_required') {
    const hint =
      (j['hint'] as string | undefined) ??
      ((j['detail'] as Record<string, unknown> | undefined)?.['hint'] as string | undefined) ??
      'Use loadAuthView() in your web app.'
    console.warn('[Onelo] ⚠️  hosted_flow_required:', hint)
    console.info('[Onelo] 💡 Fix: call onelo.auth.loadAuthView() or upgrade your Onelo plan.')
    throw OneloError.hostedFlowRequired()
  }
}
