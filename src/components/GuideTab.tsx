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
            <b>日本株全体の「本日値下がりした銘柄」</b>を自動で集め、「押し目・反発・危険」に分けて一覧表示します。安く買える候補を探すためのタブです。
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
            日本株全体から本日値下がりした銘柄を集めた一覧です。相場によって毎日入れ替わります。上部のチップで「押し目・反発・危険・登録銘柄」に絞り込めます。各行をタップすると詳細が開きます。
          </GuideRow>
          <GuideRow term={<span className="guide-chip">登録銘柄</span>}>
            <b>あなた自身が登録した銘柄</b>のこと。候補抽出タブ上部の検索や各カードの「登録」で追加、「登録解除」で削除できます。「登録銘柄」チップで自分の銘柄だけを表示できます。
          </GuideRow>
          <GuideRow term={<span className="candidate-tag tag-dip">押し目候補</span>}>
            上昇の流れは続いているのに、一時的に少し下がった銘柄。<b>上げ相場の一時的な下げ＝買い場になりやすい</b>という考え方です。
          </GuideRow>
          <GuideRow term={<span className="candidate-tag tag-rebound">反発候補</span>}>
            下がっていた銘柄が、そろそろ<b>反発（下げ止まって上向きに転じる）しそう</b>な兆しを見せている状態です。
          </GuideRow>
          <GuideRow term={<span className="candidate-tag tag-danger">危険な下落</span>}>
            短期間で大きく下げ、安値を更新しているなど<b>下落が続くリスクが高い</b>状態。安易な買いは避けたい銘柄です。
          </GuideRow>
          <GuideRow term={<span className="candidate-tag tag-skip">見送り</span>}>
            明確な買い場のサインが乏しく<b>様子見が無難</b>な状態。候補一覧には原則表示しません（登録した銘柄がこの状態のときだけ表示されます）。
          </GuideRow>
          <GuideRow term={<span className="guide-metric val-positive">反発期待<br />64.4</span>}>
            反発しそうな度合いを0〜100で表した目安。数字が大きいほど反発を期待しやすい、という指標です。
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
            ）。高いほど下げが続くリスクが大きい、という意味です。
          </GuideRow>
          <GuideRow term={<span className="guide-metric">1単元（100株）<br />17.2万円</span>}>
            日本株は原則100株単位でしか買えません。その1単元を買うのに必要な金額です（手数料は含みません）。
          </GuideRow>
          <GuideRow term={<span className="guide-metric">目標（5営業日）<br />3,313円</span>}>
            その銘柄自身の値動きの荒さ（直近20日のボラティリティ）から見た、5営業日での上値の目安です。
            値動きの小さい大型株と荒い小型株で同じ目標を置いても意味がないため、銘柄ごとに計算しています。
          </GuideRow>
          <GuideRow term={<span className="guide-metric">損切り目安<br />2,980円</span>}>
            同じ考え方で求めた下値の目安です。買う前にここを割ったら撤退する、と決めておくために使います。
          </GuideRow>
          <GuideRow term={<span className="guide-metric">売買代金 / 出来高</span>}>
            その日にどれだけ売買されたかの目安。少なすぎる銘柄は買値・売値が不利になりやすいため、
            候補からは自動的に除外しています。
          </GuideRow>
          <GuideRow term={<span className="guide-chip">過去の同条件の実績</span>}>
            <b>同じ銘柄の過去データ</b>で同じ条件が出た日を探し、その5営業日後に上がっていた割合と平均の値動きを表示します。
            標本が少ないときは「集計できていません」と出ます。過去にそうだったというだけで、今回を保証するものではありません。
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
            1単元（100株）の必要資金・目標株価・損切り目安・目標到達時の税引後利益を表示します（税率20.315%で概算）。
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
