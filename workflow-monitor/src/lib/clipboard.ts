export async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textArea = document.createElement("textarea")
  textArea.value = text
  textArea.setAttribute("readonly", "")
  textArea.style.position = "fixed"
  textArea.style.inset = "0 auto auto 0"
  textArea.style.opacity = "0"
  document.body.appendChild(textArea)
  textArea.select()
  const copied = document.execCommand("copy")
  document.body.removeChild(textArea)
  if (!copied) {
    throw new Error("Copy failed")
  }
}
