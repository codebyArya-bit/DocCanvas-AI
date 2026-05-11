import { getSharedBrowser } from './_lib'

/**
 * Pre-warms the browser instance by starting it in the background.
 * This should be called during application startup to reduce
 * the latency of the first browser request.
 */
export async function prewarmBrowser(): Promise<boolean> {
  try {
    console.time('Browser pre-warm')
    // Start browser initialization in background
    const browserPromise = getSharedBrowser()
    
    // Wait a short time for initialization to start, but don't block
    await Promise.race([
      browserPromise,
      new Promise(resolve => setTimeout(resolve, 500))
    ])
    
    console.timeEnd('Browser pre-warm')
    console.log('Browser pre-warming initiated')
    
    // Continue initialization in background
    browserPromise.then(
      () => console.log('Browser pre-warm completed successfully'),
      (error: Error) => console.error('Browser pre-warm failed:', error.message)
    )
    
    return true
  } catch (error: unknown) {
    console.error('Browser pre-warm error:', error)
    return false
  }
}

/**
 * Pre-warms the webpage browser instance (used by webpage/_lib.ts)
 */
export async function prewarmWebpageBrowser(): Promise<boolean> {
  try {
    // Import dynamically to avoid circular dependencies
    const { getWebpageBrowser } = await import('../webpage/_lib')
    
    console.time('Webpage browser pre-warm')
    const browserPromise = getWebpageBrowser()
    
    await Promise.race([
      browserPromise,
      new Promise(resolve => setTimeout(resolve, 500))
    ])
    
    console.timeEnd('Webpage browser pre-warm')
    console.log('Webpage browser pre-warming initiated')
    
    browserPromise.then(
      () => console.log('Webpage browser pre-warm completed'),
      (error: Error) => console.error('Webpage browser pre-warm failed:', error.message)
    )
    
    return true
  } catch (error: unknown) {
    console.error('Webpage browser pre-warm error:', error)
    return false
  }
}

/**
 * Pre-warms all browser instances used by the application
 */
export async function prewarmAllBrowsers(): Promise<boolean> {
  console.log('Starting browser pre-warming...')
  
  // Start both pre-warms in parallel
  const results = await Promise.allSettled([
    prewarmBrowser(),
    prewarmWebpageBrowser()
  ])
  
  const successCount = results.filter(r => r.status === 'fulfilled' && r.value).length
  console.log(`Browser pre-warming completed: ${successCount}/2 successful`)
  
  return successCount > 0
}