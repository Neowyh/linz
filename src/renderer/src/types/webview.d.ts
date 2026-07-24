declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string
          allowpopups?: string
          preload?: string
          partition?: string
          disablewebsecurity?: boolean
          httpreferrer?: string
          useragent?: string
          nodeintegration?: boolean
          plugins?: boolean
          autosize?: string
          minwidth?: number
          minheight?: number
          maxwidth?: number
          maxheight?: number
        },
        HTMLElement
      >
    }
  }
}

export {}
