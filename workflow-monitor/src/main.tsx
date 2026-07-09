import "@fontsource/jetbrains-mono/400.css"
import "@fontsource/space-grotesk/400.css"
import "@fontsource/space-grotesk/500.css"
import "@fontsource/space-grotesk/700.css"
import "@xyflow/react/dist/style.css"

import React from "react"
import ReactDOM from "react-dom/client"

import { App } from "@/app"
import "@/styles.css"

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
