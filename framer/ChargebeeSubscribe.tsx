import {forwardRef, useEffect, useRef, useState} from "react"
import type {ComponentType, MouseEvent} from "react"

const BACKEND_URL = "https://YOUR-BACKEND.vercel.app"

type Member = {id: string}
type Memberstack = {
    getCurrentMember: () => Promise<{data: Member | null}>
    getMemberCookie: () => string | undefined
    openModal: (type: string, options?: object) => Promise<unknown>
    hideModal: () => Promise<unknown>
}

const messages: Record<string, string> = {
    login_required: "Please sign in and try again.",
    invalid_session: "Please sign out, sign in, and try again.",
    subscription_exists: "This account already has a subscription record. No new purchase was started.",
    checkout_in_progress: "Another checkout request is processing. Please try again shortly.",
    checkout_not_configured: "Checkout is not configured yet.",
    origin_not_allowed: "Checkout is not enabled for this website address.",
    invalid_checkout_request: "The checkout request was not accepted.",
}

function withCheckout(Component: ComponentType<any>, currency: "INR" | "USD"): ComponentType<any> {
    return forwardRef<any, any>(function SubscribeButton(props, ref) {
        const busy = useRef(false)
        const mounted = useRef(true)
        const controller = useRef<AbortController | null>(null)
        const [loading, setLoading] = useState(false)

        useEffect(() => {
            mounted.current = true
            return () => {
                mounted.current = false
                controller.current?.abort()
            }
        }, [])

        async function handleClick(event?: MouseEvent) {
            event?.preventDefault()
            event?.stopPropagation()
            if (busy.current) return
            busy.current = true
            setLoading(true)
            let timeout: ReturnType<typeof setTimeout> | undefined
            try {
                if (BACKEND_URL.includes("YOUR-BACKEND")) {
                    window.alert("Set BACKEND_URL in ChargebeeSubscribe first.")
                    return
                }
                const backend = new URL(BACKEND_URL)
                if (backend.protocol !== "https:" || backend.username || backend.password) {
                    window.alert("Checkout requires an HTTPS backend address.")
                    return
                }
                const sdk = (window as unknown as {$memberstackDom?: Memberstack}).$memberstackDom
                if (!sdk) {
                    window.alert("Sign-in is still loading. Please try again.")
                    return
                }
                let member = (await sdk.getCurrentMember()).data
                if (!member) {
                    await sdk.openModal("LOGIN", {signup: {plans: []}})
                    member = (await sdk.getCurrentMember()).data
                    if (!member) return
                    await sdk.hideModal()
                }
                if (!mounted.current) return
                const token = sdk.getMemberCookie()
                if (!token) {
                    window.alert(messages.login_required)
                    return
                }
                const pending = new AbortController()
                controller.current = pending
                timeout = setTimeout(() => pending.abort(), 30000)
                const response = await fetch(new URL("/api/checkout", backend), {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({currency, requestId: crypto.randomUUID()}),
                    cache: "no-store",
                    credentials: "omit",
                    redirect: "error",
                    signal: pending.signal,
                })
                const result = await response.json()
                if (!mounted.current) return
                if (!response.ok) {
                    window.alert(messages[result.error] || "Checkout is temporarily unavailable. Please try again.")
                    return
                }
                if ((await sdk.getCurrentMember()).data?.id !== member.id ||
                    !mounted.current || pending.signal.aborted) return
                const checkout = new URL(result.url)
                if (checkout.protocol !== "https:" || checkout.username || checkout.password ||
                    !checkout.hostname.endsWith(".chargebee.com") ||
                    !checkout.pathname.startsWith("/pages/")) {
                    window.alert("Checkout returned an invalid address.")
                    return
                }
                window.location.assign(checkout.href)
            } catch {
                if (mounted.current) {
                    window.alert("Checkout did not open. Check your connection and try again.")
                }
            } finally {
                if (timeout) clearTimeout(timeout)
                controller.current = null
                busy.current = false
                if (mounted.current) setLoading(false)
            }
        }

        return <Component {...props} ref={ref} onClick={handleClick}
            disabled={loading} aria-disabled={loading} aria-busy={loading}
            style={{...props.style, cursor: loading ? "wait" : props.style?.cursor}} />
    })
}

export function withSubscribeINR(Component: ComponentType<any>): ComponentType<any> {
    return withCheckout(Component, "INR")
}

export function withSubscribeUSD(Component: ComponentType<any>): ComponentType<any> {
    return withCheckout(Component, "USD")
}