// Configuration constants for the PRism extension

const CONFIG = {
  DEFAULT_PER_PAGE: 10,
  CONCURRENT: 4,
  TTL_STATS: 10 * 60 * 1000,   // 10 minutes
  TTL_PRS: 5 * 60 * 1000,      // 5 minutes
  TTL_COMMENTS: 5 * 60 * 1000, // 5 minutes
  DEFAULT_REPO: 'apache/flink',
  GITHUB_API: 'https://api.github.com',
  
  // Preset repository list
  PRESET_REPOS: [
    { value: 'apache/flink', label: 'Apache Flink' },
    { value: 'apache/flink-connector-http', label: 'Flink Connector HTTP' },
    { value: 'apache/flink-connector-kafka', label: 'Flink Connector Kafka' },
    { value: 'apache/flink-connector-jdbc', label: 'Flink Connector JDBC' },
    { value: 'apache/flink-connector-elasticsearch', label: 'Flink Connector ES' },
    { value: 'apache/flink-cdc', label: 'Flink CDC' },
    { value: 'apache/flink-ml', label: 'Flink ML' },
    { value: 'apache/flink-kubernetes-operator', label: 'Flink K8s Operator' },
  ],
};

export { CONFIG };