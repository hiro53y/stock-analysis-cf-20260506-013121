import { CANDIDATE_DISCLAIMER } from '../../shared/constants'
import type { ReactNode } from 'react'

function GuideRow({ term, children }: { term: ReactNode; children: ReactNode }) {
  return (
    <div className="guide-row">
      <div className="guide-term">{term}</div>
      <div className="guide-desc">{children}</div>
    </div>
  )
}

export function GuideTab() {
  return (
    <div className="guide-tab">
      <section className="panel">
        <div className="panel-heading compact">
          <p className="eyebrow">はじめに</p>
          <h3>3つのタブの役割</h3>
        </div>
        <div className="guide-list">
          <GuideRow term={<span className="guide-chip">候補抽出</span>}>
            日本株全体から本日値下がりした銘柄を集め、<b>その銘柄自身の過去と比べて割安かどうか</b>で
            「買い候補・監視・割安だが要注意」に仕分けます。<b>割安になった株を探すためのタブ</b>です。
          </GuideRow>
          <GuideRow term={<span className="guide-chip">個別株調査</span>}>
            気になる1銘柄を入力して、株価・騰落率・分析結果をくわしく調べます。ここで「登録銘柄に追加」すると、候補抽出の「登録銘柄」でも絞り込めます。
          </GuideRow>
          <GuideRow term={<span className="guide-chip">使用方法</span>}>
            このページです。用語や結果の見方を確認できます。
          </GuideRow>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading compact">
          <p className="eyebrow">候補抽出タブ</p>
          <h3>用語の意味</h3>
        </div>
        <div className="guide-list">
          <GuideRow term={<span className="guide-chip">本日の候補</span>}>
            日本株全体から本日値下がりした銘柄を集め、<b>安値圏にあるものだけ</b>を残した一覧です。
            上部のチップで絞り込め、各行をタップすると判断材料が開きます。
            安値圏まで下げた銘柄がない日は候補が少なくなります。
          </GuideRow>
          <GuideRow term={<span className="guide-chip">登録銘柄</span>}>
            <b>あなた自身が登録した銘柄</b>のこと。候補抽出タブ上部の検索や各カードの「登録」で追加、「登録解除」で削除できます。「登録銘柄」チップで自分の銘柄だけを表示できます。
          </GuideRow>
          <GuideRow term={<span className="candidate-tag tag-buy">買い候補</span>}>
            <b>その銘柄自身の過去2年と比べて安値圏</b>まで下げ、しかも<b>下げ止まりの兆し</b>がある状態。
            いま検討する価値がある、という位置づけです。
          </GuideRow>
          <GuideRow term={<span className="candidate-tag tag-watch">監視</span>}>
            安値圏ではあるものの、<b>まだ下げている最中</b>。
            下げ止まりを確認してから検討するための枠です。
          </GuideRow>
          <GuideRow term={<span className="candidate-tag tag-trap">割安だが要注意</span>}>
            安値圏だが<b>下落が続くリスクが高い</b>状態。安いのには理由がある可能性（バリュートラップ）があります。
            決算や適時開示を必ず確認してください。
          </GuideRow>
          <GuideRow term={<span className="candidate-tag tag-skip">見送り</span>}>
            <b>安値圏ではない</b>銘柄。今日たまたま下がっただけで、その銘柄にとって安い水準ではありません。
            候補一覧には原則表示しません（登録した銘柄だけ表示されます）。
          </GuideRow>
          <GuideRow term={<span className="guide-metric">安値圏 12%</span>}>
            <b>この画面でいちばん重要な数字</b>です。現在の株価が、その銘柄の過去2年の値動きのなかで
            <b>下から何%の位置にあるか</b>を表します。12%なら「過去2年のうち、これより安かった日は12%しかない」という意味です。
            30%以下を安値圏として扱います。業種平均やPERの絶対水準ではなく、<b>その銘柄自身との比較</b>である点に注意してください。
          </GuideRow>
          <GuideRow term={<span className="guide-metric">200日線からの乖離<br />-14.2%</span>}>
            長期の平均株価（200日移動平均）からどれだけ離れているか。「過去2年で下位6%の深さ」という補足が付きます。
            同じ-14%でも、普段から荒い銘柄なら珍しくなく、普段おとなしい銘柄なら異常な深さ、という違いを見るためです。
          </GuideRow>
          <GuideRow term={<span className="guide-metric">52週高値から<br />-23.5%</span>}>
            この1年の高値からどれだけ下げたか。高値掴みを避けるための定番の見方です。
          </GuideRow>
          <GuideRow
            term={
              <span className="guide-metric">
                下落継続リスク
                <br />
                38 <span className="risk-band band-mid">中</span>
              </span>
            }
          >
            下落が続きそうな度合い（0〜100）と区分（
            <span className="risk-band band-low">低</span>
            <span className="risk-band band-mid">中</span>
            <span className="risk-band band-high">高</span>
            ）。高いと「割安だが要注意」に分類されます。
          </GuideRow>
          <GuideRow term={<span className="guide-metric">最低購入代金<br />29.9万円</span>}>
            日本株は原則100株単位でしか買えません。1単元を買うのに必要な金額です（手数料は含みません）。
            単元が100株でない銘柄もあり、その場合は実際の単元で計算します。
          </GuideRow>
          <GuideRow term={<span className="guide-metric">目標（約1か月）<br />2,980円</span>}>
            その銘柄自身の値動きの荒さ（直近20日のボラティリティ）から見た、<b>約1か月（20営業日）</b>での上値の目安です。
            値動きの小さい大型株と荒い小型株に同じ目標を置いても意味がないため、銘柄ごとに計算しています。
            損切り目安も同じ考え方で出しています。
          </GuideRow>
          <GuideRow term={<span className="guide-metric">売買代金 / 出来高</span>}>
            その日にどれだけ売買されたかの目安。少なすぎる銘柄は買値・売値が不利になりやすいため、
            候補からは自動的に除外しています。
          </GuideRow>
          <GuideRow term={<span className="guide-chip">PER / PBR / 配当利回り</span>}>
            カードを開いたときに、その銘柄だけ追加で取得する参考指標です。安値圏という判断の裏づけとして見ます。
            取得できなかった項目は表示しません（推測では埋めません）。
          </GuideRow>
          <GuideRow term={<span className="guide-chip">直近決算 / 収益性・安定性・成長性</span>}>
            <b>「なぜ下がったか」を判断する材料</b>です。安くなった理由が業績の悪化なら、
            安値圏でも買うべきではないかもしれません。決算の要約と、収益性・安定性・成長性それぞれの評価を表示します。
          </GuideRow>
          <GuideRow term={<span className="guide-chip">証券アナリストの見方</span>}>
            プロの証券アナリストのコンセンサス（判断・平均目標株価・人数の内訳）を、みんかぶから取得して表示します。
            <b>この目標株価は「1年後」の予想</b>で、アプリ自身の「目標（約1か月）」とは時間軸が違います。
            目標株価の推移も出すので、直近で引き下げられているならそれ自体が材料になります。
            <b>本アプリの分類やスコアには使っていません</b>（外部の見方は、あくまで参考として並べています）。
          </GuideRow>
          <GuideRow term={<span className="guide-chip">アナリスト予想と会社予想の差</span>}>
            今期の1株利益について、アナリストの予想が会社の予想をどれだけ上回っている（下回っている）かです。
            安くなった理由が業績なら、ここに差が出ます。
          </GuideRow>
          <GuideRow term={<span className="guide-chip">外部サイトで確認する</span>}>
            その銘柄のページを Yahoo!ファイナンス・みんかぶ・株探・楽天証券・SBI証券・moomoo で開けます。
            <b>証券会社のアナリストレポートはログインが必要なためアプリ側では取得できません</b>が、
            ブラウザでログイン済みならリンクから直接読めます。
          </GuideRow>
          <GuideRow term={<span className="guide-chip">並び順</span>}>
            一覧の並びを「割安な順 / 必要資金が少ない順 / 本日の下落が大きい順 / 売買代金が多い順」で切り替えられます。
            カテゴリをまたいで並ぶので、買い候補と監視を横断して比べられます。
          </GuideRow>
          <GuideRow term={<span className="guide-chip">過去に同じ条件が出たとき</span>}>
            <b>同じ銘柄の過去2年</b>で安値圏まで下げた日を探し、その20営業日後どうなったかを集計します。
            <b>必ず「条件なしの同期間平均」も併記します。</b>
            相場全体が good だった時期なら何もしなくても上がっているため、
            その差（実質の上乗せ）を見ないと判断を誤ります。
            保有中にどれだけ含み損に耐える必要があったか（最大下落）も表示します。
            標本が少ないときは表示しません。過去の傾向であって、将来を保証するものではありません。
          </GuideRow>
          <GuideRow
            term={
              <span className="guide-buttons">
                <span className="mini-button primary">詳しく分析</span>
                <span className="mini-button secondary">登録</span>
              </span>
            }
          >
            「詳しく分析」で個別株調査タブへ移動して自動で詳しく調べます。「登録」で登録銘柄に追加（登録済みなら「登録解除」に変わります）。
          </GuideRow>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading compact">
          <p className="eyebrow">個別株調査タブ</p>
          <h3>分析結果の見方</h3>
        </div>
        <div className="guide-list">
          <GuideRow term={<span className="guide-metric">上昇確率<br />60.0%</span>}>
            5営業日先までに株価が上がると予測される確率の目安です。
          </GuideRow>
          <GuideRow term={<span className="guide-metric val-positive">期待リターン<br />+1.7%</span>}>
            5営業日先までに期待できる値上がり率の目安。マイナスなら値下がりが見込まれています。
          </GuideRow>
          <GuideRow term={<span className="guide-metric">モデル合意度<br />100%</span>}>
            複数の予測モデルが同じ方向（上げ／下げ）を示した割合。高いほど予測の一致度が高いことを表します。
          </GuideRow>
          <GuideRow term={<span className="guide-metric">バックテスト精度<br />48.1%</span>}>
            過去データで予測を試したときの当たり具合。低いときは過去への当てはまりが不十分な可能性があります。
          </GuideRow>
          <GuideRow
            term={
              <span className="guide-signals">
                <span className="signal-pill buy">買い</span>
                <span className="signal-pill watch">様子見</span>
                <span className="signal-pill sell">売り</span>
              </span>
            }
          >
            <b>最終判定</b>。上昇確率が買い閾値を超えると「買い」、売り閾値を下回ると「売り」、その間は「様子見」です。
          </GuideRow>
          <GuideRow term={<span className="guide-chip">直近推移 / 予測チャート</span>}>
            左は最近の実際の値動き、右は5営業日先までの予測を重ねたグラフです。
          </GuideRow>
          <GuideRow term={<span className="guide-chip">モデル比較</span>}>
            4種類の予測モデルそれぞれの期待リターン・上昇確率・精度を並べた表です。
          </GuideRow>
          <GuideRow term={<span className="guide-chip">売買の目安</span>}>
            1単元（100株）の必要資金・目標株価（約1か月）・損切り目安・目標到達時の税引後利益を表示します（税率20.315%で概算）。
          </GuideRow>
          <GuideRow
            term={
              <span className="guide-buttons">
                <span className="mini-button ghost">概要</span>
                <span className="mini-button ghost">バックテスト</span>
                <span className="mini-button ghost">説明可能性</span>
              </span>
            }
          >
            結果の中の切り替えタブです。「概要」で全体像、「バックテスト」で過去検証、「説明可能性」で判断の根拠となった指標を確認できます。
          </GuideRow>
        </div>
      </section>

      <p className="disclaimer candidate-disclaimer">{CANDIDATE_DISCLAIMER}</p>
    </div>
  )
}
