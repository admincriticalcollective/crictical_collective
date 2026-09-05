import { framer, type ManagedCollection } from "@framer/plugin"
import { useLayoutEffect, useState } from "react"
import { getConfig, syncCollection, type SanityConfig } from "./data.ts"

interface AppProps {
  collection: ManagedCollection
}

export function App({ collection }: AppProps) {
  const [config, setConfig] = useState<SanityConfig>({ projectId: "", dataset: "production", token: "" })
  const [isLoading, setIsLoading] = useState(true)
  const [isSyncing, setIsSyncing] = useState(false)

  useLayoutEffect(() => {
    framer.showUI({ width: 380, height: 390, resizable: false })
    getConfig(collection).then(previous => {
      if (previous) setConfig(previous)
      setIsLoading(false)
    })
  }, [collection])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSyncing(true)

    try {
      const result = await syncCollection(collection, config)
      framer.closePlugin(`Synced ${result.synced} article(s)`, { variant: "success" })
    } catch (error) {
      console.error(error)
      framer.notify(error instanceof Error ? error.message : "Sanity sync failed", { variant: "error" })
      setIsSyncing(false)
    }
  }

  if (isLoading) return <main className="loading"><div className="framer-spinner" /></main>

  return (
    <main style={{ padding: 16 }}>
      <form onSubmit={handleSubmit}>
        <label>
          Sanity project ID
          <input required value={config.projectId} onChange={event => setConfig({ ...config, projectId: event.target.value.trim() })} />
        </label>
        <label>
          Dataset
          <input required value={config.dataset} onChange={event => setConfig({ ...config, dataset: event.target.value.trim() })} />
        </label>
        <label>
          Sanity Viewer token
          <input required type="password" value={config.token} onChange={event => setConfig({ ...config, token: event.target.value.trim() })} />
        </label>
        <button type="submit" disabled={isSyncing}>
          {isSyncing ? <div className="framer-spinner" /> : "Connect and sync"}
        </button>
      </form>
    </main>
  )
}
