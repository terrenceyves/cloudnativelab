import { Kafka, logLevel } from 'kafkajs';
export const topic = 'orders.created';
export function kafka(clientId) {
  return new Kafka({ clientId, brokers: (process.env.KAFKA_BROKERS || 'kafka:9092').split(','),
    logLevel: logLevel.ERROR, connectionTimeout: 3000, requestTimeout: 5000,
    retry: { initialRetryTime: 500, retries: 4, maxRetryTime: 5000 } });
}
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
