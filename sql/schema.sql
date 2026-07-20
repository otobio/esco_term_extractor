USE occupation_search_engine;

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS ose_import_runs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source_kind VARCHAR(64) NOT NULL,
  source_name VARCHAR(128) NOT NULL,
  source_version VARCHAR(64) NULL,
  locale_scope_json JSON NULL,
  status ENUM('running', 'completed', 'failed') NOT NULL DEFAULT 'running',
  notes TEXT NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_import_runs_source (source_kind, source_name),
  INDEX idx_import_runs_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ose_source_files (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  import_run_id BIGINT UNSIGNED NOT NULL,
  source_kind VARCHAR(64) NOT NULL,
  source_name VARCHAR(128) NOT NULL,
  locale_code VARCHAR(16) NULL,
  file_family VARCHAR(128) NOT NULL,
  file_role VARCHAR(64) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  source_path VARCHAR(1000) NULL,
  checksum_sha256 CHAR(64) NULL,
  row_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ose_source_files_run
    FOREIGN KEY (import_run_id) REFERENCES ose_import_runs(id)
    ON DELETE CASCADE,
  INDEX idx_source_files_run (import_run_id),
  INDEX idx_source_files_locale (locale_code),
  INDEX idx_source_files_family (file_family)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ose_raw_rows (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source_file_id BIGINT UNSIGNED NOT NULL,
  source_row_number INT UNSIGNED NOT NULL,
  row_key VARCHAR(255) NOT NULL,
  external_uri VARCHAR(500) NULL,
  payload JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ose_raw_rows_file
    FOREIGN KEY (source_file_id) REFERENCES ose_source_files(id)
    ON DELETE CASCADE,
  UNIQUE KEY uq_raw_row (source_file_id, source_row_number),
  UNIQUE KEY uq_raw_row_key (source_file_id, row_key),
  INDEX idx_raw_rows_external_uri (external_uri(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ose_source_concepts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  import_run_id BIGINT UNSIGNED NOT NULL,
  source_file_id BIGINT UNSIGNED NULL,
  source_kind VARCHAR(64) NOT NULL,
  source_name VARCHAR(128) NOT NULL,
  locale_code VARCHAR(16) NOT NULL,
  external_id VARCHAR(255) NULL,
  external_uri VARCHAR(500) NOT NULL,
  entity_kind VARCHAR(64) NOT NULL,
  concept_type VARCHAR(128) NULL,
  preferred_label VARCHAR(500) NOT NULL,
  normalized_label VARCHAR(500) NULL,
  description TEXT NULL,
  definition_text TEXT NULL,
  scope_note TEXT NULL,
  regulated_profession_note TEXT NULL,
  broader_external_uri VARCHAR(500) NULL,
  broader_preferred_label VARCHAR(500) NULL,
  isco_group_code VARCHAR(64) NULL,
  scheme_uris_json JSON NULL,
  source_payload JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ose_source_concepts_run
    FOREIGN KEY (import_run_id) REFERENCES ose_import_runs(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_ose_source_concepts_file
    FOREIGN KEY (source_file_id) REFERENCES ose_source_files(id)
    ON DELETE SET NULL,
  UNIQUE KEY uq_source_concept (source_name, locale_code, external_uri(191)),
  INDEX idx_source_concepts_entity_kind (entity_kind),
  INDEX idx_source_concepts_locale (locale_code),
  INDEX idx_source_concepts_normalized_label (normalized_label(191)),
  INDEX idx_source_concepts_broader_uri (broader_external_uri(191)),
  INDEX idx_source_concepts_isco (isco_group_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ose_source_aliases (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source_concept_id BIGINT UNSIGNED NOT NULL,
  import_run_id BIGINT UNSIGNED NOT NULL,
  source_file_id BIGINT UNSIGNED NULL,
  locale_code VARCHAR(16) NOT NULL,
  alias VARCHAR(500) NOT NULL,
  normalized_alias VARCHAR(500) NULL,
  alias_type VARCHAR(64) NULL,
  is_preferred TINYINT(1) NOT NULL DEFAULT 0,
  source_payload JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ose_source_aliases_concept
    FOREIGN KEY (source_concept_id) REFERENCES ose_source_concepts(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_ose_source_aliases_run
    FOREIGN KEY (import_run_id) REFERENCES ose_import_runs(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_ose_source_aliases_file
    FOREIGN KEY (source_file_id) REFERENCES ose_source_files(id)
    ON DELETE SET NULL,
  UNIQUE KEY uq_source_alias (source_concept_id, locale_code, normalized_alias(191)),
  INDEX idx_source_aliases_locale_alias (locale_code, normalized_alias(191)),
  INDEX idx_source_aliases_alias_type (alias_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ose_source_relations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  import_run_id BIGINT UNSIGNED NOT NULL,
  source_file_id BIGINT UNSIGNED NULL,
  source_kind VARCHAR(64) NOT NULL,
  source_name VARCHAR(128) NOT NULL,
  locale_code VARCHAR(16) NOT NULL,
  relation_kind VARCHAR(64) NOT NULL,
  relation_type VARCHAR(128) NULL,
  parent_external_uri VARCHAR(500) NOT NULL,
  child_external_uri VARCHAR(500) NOT NULL,
  parent_label VARCHAR(500) NULL,
  child_label VARCHAR(500) NULL,
  parent_entity_kind VARCHAR(64) NULL,
  child_entity_kind VARCHAR(64) NULL,
  weight DECIMAL(8,4) NULL,
  confidence DECIMAL(6,4) NULL,
  source_payload JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ose_source_relations_run
    FOREIGN KEY (import_run_id) REFERENCES ose_import_runs(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_ose_source_relations_file
    FOREIGN KEY (source_file_id) REFERENCES ose_source_files(id)
    ON DELETE SET NULL,
  UNIQUE KEY uq_source_relation (
    source_name,
    locale_code,
    relation_kind,
    parent_external_uri(191),
    child_external_uri(191)
  ),
  INDEX idx_source_relations_parent (parent_external_uri(191)),
  INDEX idx_source_relations_child (child_external_uri(191)),
  INDEX idx_source_relations_kind (relation_kind),
  INDEX idx_source_relations_type (relation_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ose_source_memberships (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source_concept_id BIGINT UNSIGNED NOT NULL,
  collection_name VARCHAR(128) NOT NULL,
  membership_type VARCHAR(64) NOT NULL DEFAULT 'member',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ose_source_memberships_concept
    FOREIGN KEY (source_concept_id) REFERENCES ose_source_concepts(id)
    ON DELETE CASCADE,
  UNIQUE KEY uq_source_membership (source_concept_id, collection_name, membership_type),
  INDEX idx_source_memberships_collection (collection_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ose_graph_nodes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  canonical_key VARCHAR(255) NOT NULL,
  node_level ENUM('group', 'family', 'occupation') NOT NULL,
  bucket VARCHAR(64) NOT NULL DEFAULT 'occupation',
  term_type VARCHAR(64) NOT NULL,
  canonical_label VARCHAR(500) NOT NULL,
  normalized_label VARCHAR(500) NOT NULL,
  slug VARCHAR(255) NOT NULL,
  description TEXT NULL,
  status ENUM('active', 'deprecated', 'merged', 'blocked') NOT NULL DEFAULT 'active',
  is_searchable TINYINT(1) NOT NULL DEFAULT 1,
  is_leaf TINYINT(1) NOT NULL DEFAULT 1,
  source_confidence DECIMAL(6,4) NULL,
  created_by VARCHAR(128) NOT NULL DEFAULT 'system',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_graph_node_key (canonical_key),
  UNIQUE KEY uq_graph_node_slug (slug),
  INDEX idx_graph_nodes_level (node_level),
  INDEX idx_graph_nodes_normalized_label (normalized_label(191)),
  INDEX idx_graph_nodes_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ose_graph_node_sources (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  graph_node_id BIGINT UNSIGNED NOT NULL,
  source_concept_id BIGINT UNSIGNED NULL,
  source_name VARCHAR(128) NOT NULL,
  source_kind VARCHAR(64) NOT NULL,
  source_locale VARCHAR(16) NULL,
  external_uri VARCHAR(500) NULL,
  mapping_type VARCHAR(64) NOT NULL,
  confidence DECIMAL(6,4) NULL,
  notes VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ose_graph_node_sources_node
    FOREIGN KEY (graph_node_id) REFERENCES ose_graph_nodes(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_ose_graph_node_sources_source_concept
    FOREIGN KEY (source_concept_id) REFERENCES ose_source_concepts(id)
    ON DELETE SET NULL,
  INDEX idx_graph_node_sources_node (graph_node_id),
  INDEX idx_graph_node_sources_external_uri (external_uri(191)),
  INDEX idx_graph_node_sources_source (source_name, source_kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ose_graph_aliases (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  graph_node_id BIGINT UNSIGNED NOT NULL,
  locale_code VARCHAR(16) NOT NULL DEFAULT '',
  alias VARCHAR(500) NOT NULL,
  normalized_alias VARCHAR(500) NOT NULL,
  alias_type VARCHAR(64) NULL,
  alias_class ENUM(
    'preferred_label',
    'alt_label',
    'manual',
    'english_backbone',
    'crosswalk',
    'synthetic',
    'blocked_candidate'
  ) NOT NULL DEFAULT 'alt_label',
  source_name VARCHAR(128) NULL,
  source_record_type VARCHAR(64) NULL,
  confidence DECIMAL(6,4) NULL,
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  is_generic_head_only TINYINT(1) NOT NULL DEFAULT 0,
  needs_review TINYINT(1) NOT NULL DEFAULT 0,
  review_note VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ose_graph_aliases_node
    FOREIGN KEY (graph_node_id) REFERENCES ose_graph_nodes(id)
    ON DELETE CASCADE,
  UNIQUE KEY uq_graph_alias (graph_node_id, locale_code, normalized_alias(191)),
  INDEX idx_graph_aliases_lookup (locale_code, normalized_alias(191), is_active),
  INDEX idx_graph_aliases_node (graph_node_id),
  INDEX idx_graph_aliases_class (alias_class),
  INDEX idx_graph_aliases_generic (is_generic_head_only, needs_review)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ose_graph_relationships (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  parent_node_id BIGINT UNSIGNED NOT NULL,
  child_node_id BIGINT UNSIGNED NOT NULL,
  relationship_type VARCHAR(128) NOT NULL,
  source_name VARCHAR(128) NULL,
  source_relation_id BIGINT UNSIGNED NULL,
  weight DECIMAL(8,4) NULL,
  confidence DECIMAL(6,4) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ose_graph_relationships_parent
    FOREIGN KEY (parent_node_id) REFERENCES ose_graph_nodes(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_ose_graph_relationships_child
    FOREIGN KEY (child_node_id) REFERENCES ose_graph_nodes(id)
    ON DELETE CASCADE,
  UNIQUE KEY uq_graph_relationship (parent_node_id, child_node_id, relationship_type),
  INDEX idx_graph_relationships_parent (parent_node_id, relationship_type),
  INDEX idx_graph_relationships_child (child_node_id, relationship_type),
  INDEX idx_graph_relationships_type (relationship_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ose_capabilities (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  canonical_key VARCHAR(255) NOT NULL,
  capability_type ENUM('skill', 'knowledge', 'tool', 'software', 'language') NOT NULL,
  label VARCHAR(500) NOT NULL,
  normalized_label VARCHAR(500) NOT NULL,
  locale_code VARCHAR(16) NOT NULL DEFAULT 'en',
  description TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_capability_key_locale (canonical_key, locale_code),
  INDEX idx_capabilities_normalized_label (normalized_label(191)),
  INDEX idx_capabilities_type (capability_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ose_graph_capability_links (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  graph_node_id BIGINT UNSIGNED NOT NULL,
  capability_id BIGINT UNSIGNED NOT NULL,
  relationship_type VARCHAR(128) NOT NULL,
  weight DECIMAL(8,4) NULL,
  confidence DECIMAL(6,4) NULL,
  source_name VARCHAR(128) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ose_graph_cap_links_node
    FOREIGN KEY (graph_node_id) REFERENCES ose_graph_nodes(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_ose_graph_cap_links_capability
    FOREIGN KEY (capability_id) REFERENCES ose_capabilities(id)
    ON DELETE CASCADE,
  UNIQUE KEY uq_graph_cap_link (graph_node_id, capability_id, relationship_type),
  INDEX idx_graph_cap_links_node (graph_node_id, relationship_type),
  INDEX idx_graph_cap_links_capability (capability_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ose_search_meta (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  graph_node_id BIGINT UNSIGNED NOT NULL,
  family_node_id BIGINT UNSIGNED NULL,
  group_node_id BIGINT UNSIGNED NULL,
  parent_node_id BIGINT UNSIGNED NULL,
  leaf_depth TINYINT UNSIGNED NULL,
  generic_risk ENUM('low', 'medium', 'high') NOT NULL DEFAULT 'low',
  exact_alias_count INT UNSIGNED NOT NULL DEFAULT 0,
  active_alias_count INT UNSIGNED NOT NULL DEFAULT 0,
  locale_coverage_count INT UNSIGNED NOT NULL DEFAULT 0,
  has_hierarchy TINYINT(1) NOT NULL DEFAULT 0,
  has_capability_support TINYINT(1) NOT NULL DEFAULT 0,
  english_backbone_strength DECIMAL(6,4) NULL,
  search_text LONGTEXT NULL,
  dense_text LONGTEXT NULL,
  metadata_json JSON NULL,
  quality_flags_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ose_search_meta_node
    FOREIGN KEY (graph_node_id) REFERENCES ose_graph_nodes(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_ose_search_meta_family
    FOREIGN KEY (family_node_id) REFERENCES ose_graph_nodes(id)
    ON DELETE SET NULL,
  CONSTRAINT fk_ose_search_meta_group
    FOREIGN KEY (group_node_id) REFERENCES ose_graph_nodes(id)
    ON DELETE SET NULL,
  CONSTRAINT fk_ose_search_meta_parent
    FOREIGN KEY (parent_node_id) REFERENCES ose_graph_nodes(id)
    ON DELETE SET NULL,
  UNIQUE KEY uq_search_meta_node (graph_node_id),
  INDEX idx_search_meta_family (family_node_id),
  INDEX idx_search_meta_group (group_node_id),
  INDEX idx_search_meta_generic_risk (generic_risk),
  INDEX idx_search_meta_hierarchy (has_hierarchy, has_capability_support)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ose_search_meta_aliases (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  search_meta_id BIGINT UNSIGNED NOT NULL,
  locale_code VARCHAR(16) NOT NULL,
  alias VARCHAR(500) NOT NULL,
  normalized_alias VARCHAR(500) NOT NULL,
  alias_role ENUM(
    'locale_primary',
    'locale_supporting',
    'english_backbone',
    'reviewed_crosswalk',
    'family_supporting',
    'dense_support'
  ) NOT NULL,
  weight DECIMAL(6,4) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ose_search_meta_aliases_meta
    FOREIGN KEY (search_meta_id) REFERENCES ose_search_meta(id)
    ON DELETE CASCADE,
  UNIQUE KEY uq_search_meta_alias (search_meta_id, locale_code, normalized_alias(191), alias_role),
  INDEX idx_search_meta_alias_lookup (locale_code, normalized_alias(191), alias_role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ose_search_meta_ancestors (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  search_meta_id BIGINT UNSIGNED NOT NULL,
  ancestor_node_id BIGINT UNSIGNED NOT NULL,
  distance_from_leaf TINYINT UNSIGNED NOT NULL,
  ancestor_role ENUM('parent', 'family', 'group', 'broader') NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ose_search_meta_ancestors_meta
    FOREIGN KEY (search_meta_id) REFERENCES ose_search_meta(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_ose_search_meta_ancestors_node
    FOREIGN KEY (ancestor_node_id) REFERENCES ose_graph_nodes(id)
    ON DELETE CASCADE,
  UNIQUE KEY uq_search_meta_ancestor (search_meta_id, ancestor_node_id, ancestor_role),
  INDEX idx_search_meta_ancestors_node (ancestor_node_id, ancestor_role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ose_search_meta_siblings (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  search_meta_id BIGINT UNSIGNED NOT NULL,
  sibling_node_id BIGINT UNSIGNED NOT NULL,
  sibling_kind ENUM('same_family', 'same_group', 'related') NOT NULL DEFAULT 'same_family',
  weight DECIMAL(6,4) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ose_search_meta_siblings_meta
    FOREIGN KEY (search_meta_id) REFERENCES ose_search_meta(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_ose_search_meta_siblings_node
    FOREIGN KEY (sibling_node_id) REFERENCES ose_graph_nodes(id)
    ON DELETE CASCADE,
  UNIQUE KEY uq_search_meta_sibling (search_meta_id, sibling_node_id, sibling_kind),
  INDEX idx_search_meta_siblings_node (sibling_node_id, sibling_kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ose_search_meta_capability_hints (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  search_meta_id BIGINT UNSIGNED NOT NULL,
  capability_id BIGINT UNSIGNED NOT NULL,
  hint_kind ENUM('essential', 'optional', 'knowledge', 'tool', 'software') NOT NULL,
  weight DECIMAL(6,4) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ose_search_meta_cap_hints_meta
    FOREIGN KEY (search_meta_id) REFERENCES ose_search_meta(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_ose_search_meta_cap_hints_capability
    FOREIGN KEY (capability_id) REFERENCES ose_capabilities(id)
    ON DELETE CASCADE,
  UNIQUE KEY uq_search_meta_cap_hint (search_meta_id, capability_id, hint_kind),
  INDEX idx_search_meta_cap_hints_capability (capability_id, hint_kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ose_embedding_models (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  model_key VARCHAR(128) NOT NULL,
  model_family VARCHAR(128) NOT NULL,
  provider VARCHAR(128) NULL,
  dimensions INT UNSIGNED NOT NULL,
  pooling_strategy VARCHAR(64) NULL,
  normalization_strategy VARCHAR(64) NULL,
  is_multilingual TINYINT(1) NOT NULL DEFAULT 0,
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_embedding_model_key (model_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ose_node_embeddings (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  graph_node_id BIGINT UNSIGNED NOT NULL,
  embedding_model_id BIGINT UNSIGNED NOT NULL,
  text_role ENUM('dense_text', 'search_text', 'display_name', 'alias_bundle') NOT NULL,
  locale_code VARCHAR(16) NULL,
  text_hash CHAR(64) NOT NULL,
  embedding_json JSON NOT NULL,
  vector_norm DOUBLE NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ose_node_embeddings_node
    FOREIGN KEY (graph_node_id) REFERENCES ose_graph_nodes(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_ose_node_embeddings_model
    FOREIGN KEY (embedding_model_id) REFERENCES ose_embedding_models(id)
    ON DELETE CASCADE,
  UNIQUE KEY uq_node_embedding (graph_node_id, embedding_model_id, text_role, locale_code, text_hash),
  INDEX idx_node_embeddings_node (graph_node_id),
  INDEX idx_node_embeddings_model (embedding_model_id, text_role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ose_alias_embedding_candidates (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  graph_alias_id BIGINT UNSIGNED NOT NULL,
  embedding_model_id BIGINT UNSIGNED NOT NULL,
  locale_code VARCHAR(16) NOT NULL,
  text_hash CHAR(64) NOT NULL,
  embedding_json JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ose_alias_embedding_candidates_alias
    FOREIGN KEY (graph_alias_id) REFERENCES ose_graph_aliases(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_ose_alias_embedding_candidates_model
    FOREIGN KEY (embedding_model_id) REFERENCES ose_embedding_models(id)
    ON DELETE CASCADE,
  UNIQUE KEY uq_alias_embedding_candidate (graph_alias_id, embedding_model_id, text_hash),
  INDEX idx_alias_embedding_candidates_alias (graph_alias_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ose_evaluation_queries (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  locale_code VARCHAR(16) NOT NULL,
  query_text VARCHAR(1000) NOT NULL,
  normalized_query VARCHAR(1000) NULL,
  query_kind ENUM('title', 'description', 'keyword', 'mixed') NOT NULL DEFAULT 'title',
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_eval_queries_locale (locale_code),
  INDEX idx_eval_queries_normalized (normalized_query(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ose_evaluation_expectations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  evaluation_query_id BIGINT UNSIGNED NOT NULL,
  expected_node_id BIGINT UNSIGNED NOT NULL,
  expectation_level ENUM('exact_leaf', 'acceptable_leaf', 'family', 'group') NOT NULL DEFAULT 'exact_leaf',
  rank_ceiling INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ose_eval_expectations_query
    FOREIGN KEY (evaluation_query_id) REFERENCES ose_evaluation_queries(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_ose_eval_expectations_node
    FOREIGN KEY (expected_node_id) REFERENCES ose_graph_nodes(id)
    ON DELETE CASCADE,
  UNIQUE KEY uq_eval_expectation (evaluation_query_id, expected_node_id, expectation_level)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ose_search_runs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  run_label VARCHAR(255) NOT NULL,
  code_version VARCHAR(128) NULL,
  config_json JSON NOT NULL,
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_search_runs_label (run_label)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ose_search_run_results (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  search_run_id BIGINT UNSIGNED NOT NULL,
  evaluation_query_id BIGINT UNSIGNED NOT NULL,
  graph_node_id BIGINT UNSIGNED NOT NULL,
  rank_position INT UNSIGNED NOT NULL,
  score DOUBLE NOT NULL,
  retrieval_sources_json JSON NULL,
  decision_stage VARCHAR(64) NULL,
  explanation_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ose_search_run_results_run
    FOREIGN KEY (search_run_id) REFERENCES ose_search_runs(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_ose_search_run_results_query
    FOREIGN KEY (evaluation_query_id) REFERENCES ose_evaluation_queries(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_ose_search_run_results_node
    FOREIGN KEY (graph_node_id) REFERENCES ose_graph_nodes(id)
    ON DELETE CASCADE,
  UNIQUE KEY uq_search_run_result (search_run_id, evaluation_query_id, graph_node_id),
  INDEX idx_search_run_results_rank (search_run_id, evaluation_query_id, rank_position),
  INDEX idx_search_run_results_node (graph_node_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ose_manual_review_queue (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  review_type ENUM(
    'alias_conflict',
    'generic_head',
    'hierarchy_gap',
    'relatedness_gap',
    'cross_locale_gap',
    'dense_candidate'
  ) NOT NULL,
  locale_code VARCHAR(16) NULL,
  subject_text VARCHAR(500) NULL,
  normalized_subject_text VARCHAR(500) NULL,
  graph_node_id BIGINT UNSIGNED NULL,
  payload_json JSON NOT NULL,
  review_status ENUM('pending', 'approved', 'rejected', 'ignored') NOT NULL DEFAULT 'pending',
  reviewer_note TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ose_manual_review_queue_node
    FOREIGN KEY (graph_node_id) REFERENCES ose_graph_nodes(id)
    ON DELETE SET NULL,
  INDEX idx_manual_review_queue_status (review_status, review_type),
  INDEX idx_manual_review_queue_subject (locale_code, normalized_subject_text(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ose_build_artifacts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  artifact_key VARCHAR(128) NOT NULL,
  artifact_scope VARCHAR(64) NOT NULL,
  build_version VARCHAR(128) NULL,
  payload_json JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_build_artifact (artifact_key, artifact_scope, build_version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
