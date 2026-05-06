import { MODEL_LABELS, WALK_FORWARD_FOLDS } from '../constants'
import { formatReturn, mean, toFeatureLabel } from '../utils'
import type {
  BacktestFold,
  BacktestModelSummary,
  FeatureContribution,
  ModelId,
  ModelResult,
} from '../types'
import {
  buildBacktestScore,
  directionalAccuracy,
  mae,
  normalCdf,
  predictLogistic,
  predictRidge,
  rankWeights,
  trainLogisticRegression,
  trainRidgeRegression,
} from './math'
import type { FeatureLatestRow, FeatureTrainingRow } from './features'

interface TrainBundle {
  featureNames: string[]
  rows: FeatureTrainingRow[]
}

interface Prediction {
  predictedReturn: number
  upProbability: number
}

interface TrainedModel {
  modelId: ModelId
  label: string
  predict(features: number[]): Prediction
  getFeatureImportance(limit?: number): FeatureContribution[]
  getLocalContributions(features: number[], limit?: number): FeatureContribution[]
}

interface ModelFactory {
  modelId: ModelId
  label: string
  train(bundle: TrainBundle): TrainedModel
}

export interface ModelRunOutcome {
  result: ModelResult
  summary: BacktestModelSummary
  folds: BacktestFold[]
  trainedModel?: TrainedModel
}

function buildImportance(
  featureNames: string[],
  weights: number[],
  standardizer: { means: number[]; stds: number[] },
  rawValues: number[] | null,
  limit = 8,
): FeatureContribution[] {
  return rankWeights(featureNames, weights, rawValues, standardizer, limit).map((item) => ({
    ...item,
    feature: toFeatureLabel(item.feature),
    valueText: rawValues ? formatReturn(item.score) : item.valueText,
  }))
}

function createBaselineFactory(): ModelFactory {
  return {
    modelId: 'baseline',
    label: MODEL_LABELS.baseline,
    train(bundle) {
      const returns = bundle.rows.map((row) => row.targetReturn)
      const directions = bundle.rows.map((row) => row.targetDirection)
      const meanReturn = mean(returns)
      const variance = mean(returns.map((value) => (value - meanReturn) ** 2))
      const sigma = Math.max(Math.sqrt(variance), 0.01)
      const upProbability = mean(directions)

      return {
        modelId: 'baseline',
        label: MODEL_LABELS.baseline,
        predict() {
          return {
            predictedReturn: meanReturn,
            upProbability: Number.isFinite(upProbability)
              ? upProbability
              : 1 - normalCdf(0, meanReturn, sigma),
          }
        },
        getFeatureImportance() {
          return []
        },
        getLocalContributions() {
          return []
        },
      }
    },
  }
}

function createArTrendFactory(): ModelFactory {
  return {
    modelId: 'ar_trend',
    label: MODEL_LABELS.ar_trend,
    train(bundle) {
      const features = bundle.rows.map((row) => row.features)
      const returns = bundle.rows.map((row) => row.targetReturn)
      const model = trainRidgeRegression(features, returns, {
        learningRate: 0.045,
        iterations: 420,
        lambda: 0.03,
      })

      return {
        modelId: 'ar_trend',
        label: MODEL_LABELS.ar_trend,
        predict(featureRow) {
          const predictedReturn = predictRidge(model, featureRow)
          return {
            predictedReturn,
            upProbability: normalCdf(predictedReturn, 0, Math.max(Math.abs(predictedReturn), 0.035)),
          }
        },
        getFeatureImportance(limit = 8) {
          return buildImportance(bundle.featureNames, model.weights, model.standardizer, null, limit)
        },
        getLocalContributions(featureRow, limit = 8) {
          return buildImportance(bundle.featureNames, model.weights, model.standardizer, featureRow, limit)
        },
      }
    },
  }
}

function createDirectionFactory(): ModelFactory {
  return {
    modelId: 'direction_classifier',
    label: MODEL_LABELS.direction_classifier,
    train(bundle) {
      const features = bundle.rows.map((row) => row.features)
      const returns = bundle.rows.map((row) => row.targetReturn)
      const directions = bundle.rows.map((row) => row.targetDirection)
      const model = trainLogisticRegression(features, directions, returns)

      return {
        modelId: 'direction_classifier',
        label: MODEL_LABELS.direction_classifier,
        predict(featureRow) {
          const { probability, predictedReturn } = predictLogistic(model, featureRow)
          return {
            predictedReturn,
            upProbability: probability,
          }
        },
        getFeatureImportance(limit = 8) {
          return buildImportance(bundle.featureNames, model.weights, model.standardizer, null, limit)
        },
        getLocalContributions(featureRow, limit = 8) {
          return buildImportance(bundle.featureNames, model.weights, model.standardizer, featureRow, limit)
        },
      }
    },
  }
}

function createReturnFactory(): ModelFactory {
  return {
    modelId: 'return_regressor',
    label: MODEL_LABELS.return_regressor,
    train(bundle) {
      const features = bundle.rows.map((row) => row.features)
      const returns = bundle.rows.map((row) => row.targetReturn)
      const model = trainRidgeRegression(features, returns, {
        learningRate: 0.05,
        iterations: 500,
        lambda: 0.015,
      })

      return {
        modelId: 'return_regressor',
        label: MODEL_LABELS.return_regressor,
        predict(featureRow) {
          const predictedReturn = predictRidge(model, featureRow)
          return {
            predictedReturn,
            upProbability: normalCdf(predictedReturn, 0, 0.04),
          }
        },
        getFeatureImportance(limit = 8) {
          return buildImportance(bundle.featureNames, model.weights, model.standardizer, null, limit)
        },
        getLocalContributions(featureRow, limit = 8) {
          return buildImportance(bundle.featureNames, model.weights, model.standardizer, featureRow, limit)
        },
      }
    },
  }
}

const modelFactories: ModelFactory[] = [
  createBaselineFactory(),
  createArTrendFactory(),
  createDirectionFactory(),
  createReturnFactory(),
]

function evaluateFactory(
  factory: ModelFactory,
  featureNames: string[],
  rows: FeatureTrainingRow[],
): BacktestFold[] {
  const foldSize = Math.floor(rows.length / (WALK_FORWARD_FOLDS + 1))
  if (foldSize < 20) {
    throw new Error('バックテストに十分なデータがありません。')
  }

  const folds: BacktestFold[] = []
  for (let foldIndex = 0; foldIndex < WALK_FORWARD_FOLDS; foldIndex += 1) {
    const trainEnd = foldSize * (foldIndex + 1)
    const testStart = trainEnd
    const testEnd =
      foldIndex === WALK_FORWARD_FOLDS - 1
        ? rows.length
        : Math.min(rows.length, testStart + foldSize)
    const trainRows = rows.slice(0, trainEnd)
    const testRows = rows.slice(testStart, testEnd)

    if (trainRows.length < 30 || testRows.length === 0) continue

    const model = factory.train({ featureNames, rows: trainRows })
    const predictions = testRows.map((row) => model.predict(row.features))
    const predictedReturns = predictions.map((prediction) => prediction.predictedReturn)
    const actualReturns = testRows.map((row) => row.targetReturn)
    const directionScore = directionalAccuracy(predictedReturns, actualReturns)
    const maeReturn = mae(predictedReturns, actualReturns)

    folds.push({
      foldIndex,
      trainSize: trainRows.length,
      testSize: testRows.length,
      directionalAccuracy: directionScore,
      maeReturn,
      score: buildBacktestScore(directionScore, maeReturn),
    })
  }

  return folds
}

function summarizeBacktest(modelId: ModelId, label: string, folds: BacktestFold[]): BacktestModelSummary {
  return {
    modelId,
    label,
    directionalAccuracy: mean(folds.map((fold) => fold.directionalAccuracy)),
    maeReturn: mean(folds.map((fold) => fold.maeReturn)),
    recentScore: folds[folds.length - 1]?.score ?? 0,
    foldCount: folds.length,
  }
}

export function getModelOutcomes(
  featureNames: string[],
  trainingRows: FeatureTrainingRow[],
  latestRow: FeatureLatestRow,
): ModelRunOutcome[] {
  return modelFactories.map((factory) => {
    try {
      const folds = evaluateFactory(factory, featureNames, trainingRows)
      const summary = summarizeBacktest(factory.modelId, factory.label, folds)
      const trainedModel = factory.train({ featureNames, rows: trainingRows })
      const latestPrediction = trainedModel.predict(latestRow.features)

      return {
        result: {
          modelId: factory.modelId,
          label: factory.label,
          status: 'ok',
          predictedReturn: latestPrediction.predictedReturn,
          upProbability: latestPrediction.upProbability,
          recentBacktestScore: summary.recentScore,
        },
        summary,
        folds,
        trainedModel,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'モデル評価に失敗しました。'
      return {
        result: {
          modelId: factory.modelId,
          label: factory.label,
          status: 'error',
          predictedReturn: null,
          upProbability: null,
          recentBacktestScore: null,
          errorMessage: message,
        },
        summary: {
          modelId: factory.modelId,
          label: factory.label,
          directionalAccuracy: 0,
          maeReturn: 0,
          recentScore: 0,
          foldCount: 0,
          errorMessage: message,
        },
        folds: [],
      }
    }
  })
}

export function chooseExplainableModel(
  outcomes: ModelRunOutcome[],
  latestFeatures: number[],
): {
  featureImportance: FeatureContribution[]
  localContributions: FeatureContribution[]
} {
  const preferredOrder: ModelId[] = ['return_regressor', 'direction_classifier', 'ar_trend']
  const found = preferredOrder
    .map((modelId) =>
      outcomes.find((outcome) => outcome.result.modelId === modelId && outcome.trainedModel),
    )
    .find(Boolean)

  if (!found?.trainedModel) {
    return { featureImportance: [], localContributions: [] }
  }

  return {
    featureImportance: found.trainedModel.getFeatureImportance(8),
    localContributions: found.trainedModel.getLocalContributions(latestFeatures, 8),
  }
}
