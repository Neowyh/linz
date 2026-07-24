import { RouterProvider } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { router } from './router'

function App(): JSX.Element {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#1E6FCC',
          borderRadius: 8,
          fontFamily: 'Inter, "HarmonyOS Sans SC", "思源黑体", sans-serif'
        }
      }}
    >
      <RouterProvider router={router} />
    </ConfigProvider>
  )
}

export default App
