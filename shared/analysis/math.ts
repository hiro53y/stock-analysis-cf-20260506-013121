import { clamp, mean, stdDev, toContributionDirection } from '../utils'
import type { FeatureContribution } from '../types'

export interface Standardizer {
  means: number[]
  stds: number[]
}

export interface RidgeModelArtifacts {
  bias: number
  weights: number[]
  standardizer: Standardizer
}

export interface LogisticModelArtifacts extends RidgeModelArtifacts {
  positiveReturn: number
  negativeReturn: number
}

export function fitStandardizer(rows: number[][]): Standardizer {
  const width = rows[0]?.length ?? 0
  const means = Array.from({ length: width }, (_, column) =>
    mean(rows.map((row) => row[column])),
  )
  const stds = Array.from({ length: width }, (_, column) => {
    const value = stdDev(rows.map((row) => row[column]))
    return value === 0 ? 1 : value
  })

  return { means, stds }
}

export function transformRow(row: number[], standardizer: Standardizer): number[] {
  return row.map((value, index) => (value - standardizer.means[index]) / standardizer.stds[index])
}

export function transformRows(rows: number[][], standardizer: Standardizer): number[][] {
  return rows.map((row) => transformRow(row, standardizer))
}

export function dot(left: number[], right: number[]): number {
  return left.reduce((sum, value, index) => sum + value * right[index], 0)
}

export function sigmoid(value: number): number {
  const clipped = clamp(value, -20, 20)
  return 1 / (1 + Math.exp(-clipped))
}

function erf(value: number): number {
  const sign = value < 0 ? -1 : 1
  const absolute = Math.abs(value)
  const a1 = 0.254829592
  const a2 = -0.284496736
  const a3 = 1.421413741
  const a4 = -1.453152027
  const a5 = 1.061405429
  const p = 0.3275911
  const t = 1 / (1 + p * absolute)
  const y =
    1 -
    (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absolute * absolute))
  return sign * y
}

export function normalCdf(value: number, meanValue: number, sigma: number): number {
  if (sigma <= 0) return value >= meanValue ? 1 : 0
  return 0.5 * (1 + erf((value - meanValue) / (sigma * Math.sqrt(2))))
}

export function trainRidgeRegression(
  features: number[][],
  targets: number[],
  options?: { iterations?: number; learningRate?: number; lambda?: number },
): RidgeModelArtifacts {
  const standardizer = fitStandardizer(features)
  const scaled = transformRows(features, standardizer)
  const width = scaled[0]?.length ?? 0
  const sampleCount = scaled.length

  let bias = mean(targets)
  let weights = Array.from({ length: width }, () => 0)
  const iterations = options?.iterations ?? 400
  const learningRate = options?.learningRate ?? 0.05
  const lambda = options?.lambda ?? 0.02

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const gradient = Array.from({ length: width }, () => 0)
    let biasGradient = 0

    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      const predicted = bias + dot(weights, scaled[sampleIndex])
      const error = predicted - targets[sampleIndex]
      biasGradient += error

      for (let featureIndex = 0; featureIndex < width; featureIndex += 1) {
        gradient[featureIndex] += error * scaled[sampleIndex][featureIndex]
      }
    }

    bias -= (learningRate * biasGradient) / sampleCount
    weights = weights.map((weight, index) => {
      const regularized = gradient[index] / sampleCount + lambda * weight
      return weight - learningRate * regularized
    })
  }

  return { bias, weights, standardizer }
}

export function predictRidge(model: RidgeModelArtifacts, row: number[]): number {
  return model.bias + dot(model.weights, transformRow(row, model.standardizer))
}

export function trainLogisticRegression(
  features: number[][],
  targets: number[],
  targetReturns: number[],
  options?: { iterations?: number; learningRate?: number; lambda?: number },
): LogisticModelArtifacts {
  const standardizer = fitStandardizer(features)
  const scaled = transformRows(features, standardizer)
  const width = scaled[0]?.length ?? 0
  const sampleCount = scaled.length
  const baseline = clamp(mean(targets), 0.01, 0.99)
  const positiveReturn = mean(targetReturns.filter((value) => value >= 0))
  const negativeReturn = mean(targetReturns.filter((value) => value < 0))

  let bias = Math.log(baseline / (1 - baseline))
  let weights = Array.from({ length: width }, () => 0)
  const iterations = options?.iterations ?? 450
  const learningRate = options?.learningRate ?? 0.06
  const lambda = options?.lambda ?? 0.03

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const gradient = Array.from({ length: width }, () => 0)
    let biasGradient = 0

    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      const probability = sigmoid(bias + dot(weights, scaled[sampleIndex]))
      const error = probability - targets[sampleIndex]
      biasGradient += error

      for (let featureIndex = 0; featureIndex < width; featureIndex += 1) {
        gradient[featureIndex] += error * scaled[sampleIndex][featureIndex]
      }
    }

    bias -= (learningRate * biasGradient) / sampleCount
    weights = weights.map((weight, index) => {
      const regularized = gradient[index] / sampleCount + lambda * weight
      return weight - learningRate * regularized
    })
  }

  return {
    bias,
    weights,
    standardizer,
    positiveReturn: Number.isFinite(positiveReturn) ? positiveReturn : 0.02,
    negativeReturn: Number.isFinite(negativeReturn) ? negativeReturn : -0.02,
  }
}

export function predictLogistic(model: LogisticModelArtifacts, row: number[]): {
  probability: number
  predictedReturn: number
} {
  const scaled = transformRow(row, model.standardizer)
  const probability = sigmoid(model.bias + dot(model.weights, scaled))
  const predictedReturn =
    probability * model.positiveReturn + (1 - probability) * model.negativeReturn

  return { probability, predictedReturn }
}

export function directionalAccuracy(predicted: number[], actual: number[]): number {
  if (predicted.length === 0 || actual.length === 0) return 0
  let correct = 0
  for (let index = 0; index < predicted.length; index += 1) {
    const left = predicted[index] >= 0 ? 1 : 0
    const right = actual[index] >= 0 ? 1 : 0
    if (left === right) correct += 1
  }
  return correct / predicted.length
}

export function mae(predicted: number[], actual: number[]): number {
  if (predicted.length === 0 || actual.length === 0) return 1
  return mean(predicted.map((value, index) => Math.abs(value - actual[index])))
}

export function buildBacktestScore(directionScore: number, maeReturn: number): number {
  const maeComponent = clamp(1 - maeReturn / 0.12, 0, 1)
  return clamp(directionScore * 0.7 + maeComponent * 0.3, 0, 1)
}

export function rankWeights(
  featureNames: string[],
  weights: number[],
  rawValues: number[] | null,
  standardizer: Standardizer,
  limit = 8,
): FeatureContribution[] {
  return featureNames
    .map((feature, index) => {
      const normalizedValue = rawValues
        ? (rawValues[index] - standardizer.means[index]) / standardizer.stds[index]
        : 0
      const score = rawValues ? normalizedValue * weights[index] : Math.abs(weights[index])
      return {
        feature,
        score,
        direction: toContributionDirection(score),
        valueText: rawValues
          ? `${rawValues[index] >= 0 ? '+' : ''}${rawValues[index].toFixed(2)}`
          : `重み ${weights[index].toFixed(2)}`,
      }
    })
    .sort((left, right) => Math.abs(right.score) - Math.abs(left.score))
    .slice(0, limit)
}

export function rotateValues(values: number[]): number[] {
  if (values.length <= 1) return values
  return [values[values.length - 1], ...values.slice(0, -1)]
}
