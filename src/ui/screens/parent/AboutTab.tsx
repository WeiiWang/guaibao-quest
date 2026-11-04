import { useSyncExternalStore } from 'react'
import { appUpdate } from '../../updateController'
import { APP_VERSION } from '../../version'
import './learning.css'
import './reliability.css'

/** 關於與隱私：只寫確認過的事實（程式裡的對外請求都 grep 過，見 SPEC-v8 線 R）。改了資料流向要同步改這裡 */
export function AboutTab() {
  const updateReady = useSyncExternalStore(appUpdate.subscribe, appUpdate.isReady)
  return (
    <section className="lt rl" data-testid="about-tab">
      <div className="card">
        <h2>關於乖寶任務</h2>
        <p>給 3 到 7 歲孩子的學習與養寵物 App。</p>
        <p>
          目前版本：<code data-testid="app-version">{APP_VERSION}</code>
        </p>
        {updateReady ? (
          <p className="form-msg ok" data-testid="update-ready">新版本已經下載好。孩子回到首頁、或下次打開時會自動換上，不會打斷正在玩的關卡。</p>
        ) : (
          <p className="lt-note">有新版本時會在背景下載，等孩子回到首頁或下次打開才換上，不會打斷正在玩的關卡。</p>
        )}
      </div>

      <div className="card" data-testid="privacy">
        <h2>隱私說明</h2>
        <p className="form-msg warn" data-testid="privacy-disclaimer">這份說明是開發者依照程式實際行為寫的，未經法律審查。</p>
        <h3>資料存在哪裡</h3>
        <ul className="rl-list">
          <li>孩子的名字、年齡、任務、點數、寵物、作答紀錄、著色作品，都只存在這台裝置的瀏覽器裡。</li>
          <li>家長 PIN 只存雜湊值，同樣在這台裝置上。</li>
          <li>沒有帳號，也沒有雲端同步。換裝置要自己用備份檔搬。</li>
        </ul>
        <h3>不收集什麼</h3>
        <ul className="rl-list">
          <li>App 不會把孩子的資料傳到任何伺服器。</li>
          <li>沒有廣告，沒有分析或追蹤工具，不使用 Cookie。</li>
          <li>不連第三方服務。App 只會向放置它的網站下載自己的程式、圖片、語音與音樂。</li>
        </ul>
        <h3>需要知道的例外</h3>
        <ul className="rl-list">
          <li>App 放在 GitHub Pages 上。下載程式與內容時，GitHub 身為網站主機，可能依它自己的政策記錄連線資訊（例如 IP 位址）。App 本身不會讀取或使用這些紀錄。</li>
          <li>如果有句子沒有預錄語音，會改用裝置內建的語音功能唸出來，由系統處理。</li>
          <li data-testid="privacy-talk">遊樂場的「學我說話」預設關閉，家長打開才會出現。玩的時候會用麥克風收孩子的聲音，聲音只留在這台裝置的記憶體裡，寵物學完就丟，不存檔、不上傳；離開這個玩法麥克風就關掉。</li>
          <li>只有在你主動按「分享」時（著色作品、備份檔），檔案才會離開這台裝置，去向由你選擇。</li>
          <li>備份檔裡有孩子的名字與進度，也有家長 PIN 的雜湊，內容沒有加密。請放在自己信任的地方。</li>
        </ul>
        <h3>資料什麼時候會不見</h3>
        <ul className="rl-list">
          <li>刪除 App、清除瀏覽器資料，或裝置空間不足時瀏覽器自行清理，都可能讓資料消失。建議定期下載備份檔。</li>
        </ul>
      </div>
    </section>
  )
}
