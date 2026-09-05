import "@framer/plugin/framer.css"
import { framer } from "@framer/plugin"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App.tsx"
import { syncExistingCollection } from "./data.ts"

const collection = await framer.getActiveManagedCollection()
const didSync = await syncExistingCollection(collection)

if (didSync) {
  framer.closePlugin("Synchronization successful", { variant: "success" })
} else {
  const root = document.getElementById("root")
  if (!root) throw new Error("Root element not found")

  createRoot(root).render(
    <StrictMode>
      <App collection={collection} />
    </StrictMode>,
  )
}
