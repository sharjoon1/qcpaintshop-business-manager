-- ============================================================================
-- QC Business Manager — canonical prod schema snapshot (NO DATA)
-- Source: mysqldump --no-data --skip-comments --triggers --single-transaction
--         on prod (MariaDB 10.11), AUTO_INCREMENT values stripped.
-- Taken: 2026-06-11  (D1 — answers Q-P2: includes the zoho_* tables that have
-- no DDL anywhere else in the repo).
--
-- REGENERATE per release (from the dev machine):
--   ssh hetzner "cd /www/wwwroot/act.qcpaintshop.com && node -e \"require('dotenv').config(); const {spawnSync}=require('child_process'); const r=spawnSync('mysqldump',['--no-data','--skip-comments','--triggers','--single-transaction','-h',process.env.DB_HOST,'-u',process.env.DB_USER,process.env.DB_NAME],{env:{...process.env, MYSQL_PWD:process.env.DB_PASSWORD}, maxBuffer:64*1024*1024}); require('fs').writeFileSync('/tmp/qc_schema_snapshot.sql', r.stdout)\" && sed -i 's/ AUTO_INCREMENT=[0-9]*//' /tmp/qc_schema_snapshot.sql"
--   scp hetzner:/tmp/qc_schema_snapshot.sql docs/schema/prod-schema-YYYY-MM-DD.sql
--
-- This file is REFERENCE ONLY — never execute it against any DB; schema
-- changes still go through migrations/ (see CLAUDE.md §2/§7).
-- ============================================================================
/*M!999999\- enable the sandbox mode */ 

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
DROP TABLE IF EXISTS `_migrations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `_migrations` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `applied_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `admin_notices`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `admin_notices` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `posted_by` int(11) NOT NULL,
  `title` varchar(255) NOT NULL,
  `message` text NOT NULL,
  `priority` enum('normal','important','urgent') DEFAULT 'normal',
  `target` enum('all','branch') DEFAULT 'all',
  `target_branch_id` int(11) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  `expires_at` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_active` (`is_active`,`created_at`),
  KEY `posted_by` (`posted_by`),
  CONSTRAINT `admin_notices_ibfk_1` FOREIGN KEY (`posted_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `admin_notifications`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `admin_notifications` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `title` varchar(200) NOT NULL,
  `body` text NOT NULL,
  `image_url` varchar(500) DEFAULT NULL,
  `type` enum('info','offer') NOT NULL DEFAULT 'info',
  `offer_url` varchar(500) DEFAULT NULL,
  `audience_type` enum('all','branch','level','city','specific') NOT NULL DEFAULT 'all',
  `audience_value` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`audience_value`)),
  `reach_count` int(11) NOT NULL DEFAULT 0,
  `sent_at` datetime NOT NULL,
  `created_by` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_sent_at` (`sent_at`),
  KEY `idx_type` (`type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `ai_analysis_runs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `ai_analysis_runs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `analysis_type` enum('zoho_daily','zoho_weekly','staff_daily','staff_weekly','lead_scoring','marketing_tips') NOT NULL,
  `status` enum('running','completed','failed') DEFAULT 'running',
  `summary` text DEFAULT NULL,
  `full_response` longtext DEFAULT NULL,
  `data_snapshot` longtext DEFAULT NULL CHECK (json_valid(`data_snapshot`)),
  `model_provider` varchar(50) DEFAULT NULL,
  `tokens_used` int(11) DEFAULT 0,
  `duration_ms` int(11) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_type_date` (`analysis_type`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `ai_business_context`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `ai_business_context` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `context_date` date NOT NULL,
  `context_type` enum('daily_snapshot','realtime') DEFAULT 'daily_snapshot',
  `context_data` longtext NOT NULL CHECK (json_valid(`context_data`)),
  `generated_at` timestamp NULL DEFAULT current_timestamp(),
  `generation_time_ms` int(11) DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_date_type` (`context_date`,`context_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `ai_config`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `ai_config` (
  `config_key` varchar(100) NOT NULL,
  `config_value` text DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`config_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `ai_conversations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `ai_conversations` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `title` varchar(255) DEFAULT 'New Chat',
  `model_provider` enum('gemini','claude') DEFAULT 'gemini',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `ai_insights`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `ai_insights` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `analysis_run_id` int(11) DEFAULT NULL,
  `category` enum('revenue','collections','overdue','staff','leads','marketing','general') NOT NULL,
  `severity` enum('info','warning','critical') DEFAULT 'info',
  `title` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `action_recommended` text DEFAULT NULL,
  `is_read` tinyint(1) DEFAULT 0,
  `is_dismissed` tinyint(1) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_category` (`category`),
  KEY `idx_unread` (`is_read`,`is_dismissed`),
  KEY `analysis_run_id` (`analysis_run_id`),
  CONSTRAINT `ai_insights_ibfk_1` FOREIGN KEY (`analysis_run_id`) REFERENCES `ai_analysis_runs` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `ai_lead_scores`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `ai_lead_scores` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `lead_id` int(11) NOT NULL,
  `score` int(11) DEFAULT 0,
  `score_breakdown` longtext DEFAULT NULL CHECK (json_valid(`score_breakdown`)),
  `ai_recommendation` text DEFAULT NULL,
  `suggested_assignee` int(11) DEFAULT NULL,
  `next_action` text DEFAULT NULL,
  `next_action_date` date DEFAULT NULL,
  `scored_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_lead` (`lead_id`),
  KEY `idx_score` (`score` DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `ai_messages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `ai_messages` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `conversation_id` int(11) NOT NULL,
  `role` enum('user','assistant','system') NOT NULL,
  `content` text NOT NULL,
  `tokens_used` int(11) DEFAULT 0,
  `model` varchar(100) DEFAULT NULL,
  `context_summary` varchar(500) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_conv` (`conversation_id`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_aim_conv_created` (`conversation_id`,`created_at` DESC),
  CONSTRAINT `ai_messages_ibfk_1` FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `ai_suggestions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `ai_suggestions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `category` enum('operations','software','marketing','staffing','inventory','financial','growth','general') DEFAULT 'general',
  `suggestion` text NOT NULL,
  `reasoning` text DEFAULT NULL,
  `priority` enum('low','medium','high','critical') DEFAULT 'medium',
  `status` enum('new','acknowledged','in_progress','implemented','dismissed') DEFAULT 'new',
  `source` enum('chat','analysis','proactive') DEFAULT 'proactive',
  `conversation_id` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_status` (`status`),
  KEY `idx_category` (`category`),
  KEY `conversation_id` (`conversation_id`),
  CONSTRAINT `ai_suggestions_ibfk_1` FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversations` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `attendance_daily_reports`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `attendance_daily_reports` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `branch_id` int(11) DEFAULT NULL,
  `report_date` date NOT NULL,
  `sent_via` enum('whatsapp','manual','notification') DEFAULT 'notification',
  `sent_by` int(11) DEFAULT NULL,
  `sent_at` datetime NOT NULL,
  `report_text` text NOT NULL,
  `delivery_status` enum('sent','failed','pending','notification') DEFAULT 'sent',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_user_date` (`user_id`,`report_date`),
  KEY `idx_adr_branch` (`branch_id`),
  CONSTRAINT `attendance_daily_reports_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `attendance_permissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `attendance_permissions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `attendance_id` int(11) DEFAULT NULL,
  `request_type` enum('late_arrival','early_checkout','early_leave','extended_break','leave','half_day','re_clockin','outside_work') NOT NULL,
  `request_date` date NOT NULL,
  `request_time` time DEFAULT NULL,
  `duration_minutes` int(11) DEFAULT NULL,
  `reason` text NOT NULL,
  `status` enum('pending','approved','rejected') DEFAULT 'pending',
  `requested_by` int(11) NOT NULL,
  `requested_at` timestamp NULL DEFAULT current_timestamp(),
  `reviewed_by` int(11) DEFAULT NULL,
  `reviewed_at` timestamp NULL DEFAULT NULL,
  `review_notes` text DEFAULT NULL,
  `rejection_reason` text DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `attendance_id` (`attendance_id`),
  KEY `requested_by` (`requested_by`),
  KEY `reviewed_by` (`reviewed_by`),
  KEY `idx_user_status` (`user_id`,`status`),
  KEY `idx_date` (`request_date`),
  KEY `idx_status` (`status`),
  KEY `idx_type` (`request_type`),
  KEY `idx_ap_user_type_status` (`user_id`,`request_type`,`status`),
  CONSTRAINT `attendance_permissions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `attendance_permissions_ibfk_2` FOREIGN KEY (`attendance_id`) REFERENCES `staff_attendance` (`id`) ON DELETE SET NULL,
  CONSTRAINT `attendance_permissions_ibfk_3` FOREIGN KEY (`requested_by`) REFERENCES `users` (`id`),
  CONSTRAINT `attendance_permissions_ibfk_4` FOREIGN KEY (`reviewed_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Permission requests for attendance adjustments';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `attendance_photos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `attendance_photos` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `attendance_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `photo_type` enum('clock_in','clock_out','break_start','break_end') NOT NULL,
  `file_path` varchar(500) NOT NULL,
  `file_size` int(11) DEFAULT NULL,
  `latitude` decimal(10,8) DEFAULT NULL,
  `longitude` decimal(11,8) DEFAULT NULL,
  `address` text DEFAULT NULL,
  `captured_at` timestamp NOT NULL,
  `uploaded_at` timestamp NULL DEFAULT current_timestamp(),
  `delete_after` date NOT NULL,
  `is_deleted` tinyint(1) DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_delete_after` (`delete_after`,`is_deleted`),
  KEY `idx_user` (`user_id`),
  KEY `idx_attendance` (`attendance_id`),
  CONSTRAINT `attendance_photos_ibfk_1` FOREIGN KEY (`attendance_id`) REFERENCES `staff_attendance` (`id`) ON DELETE CASCADE,
  CONSTRAINT `attendance_photos_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Attendance photos with 40-day auto-deletion';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `audit_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `audit_log` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) DEFAULT NULL,
  `action` varchar(100) NOT NULL,
  `table_name` varchar(50) DEFAULT NULL,
  `record_id` int(11) DEFAULT NULL,
  `old_value` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`old_value`)),
  `new_value` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`new_value`)),
  `ip_address` varchar(45) DEFAULT NULL,
  `timestamp` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_action` (`action`),
  KEY `idx_timestamp` (`timestamp`),
  KEY `idx_table_record` (`table_name`,`record_id`),
  CONSTRAINT `audit_log_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `audit_records`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `audit_records` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `ts` timestamp NULL DEFAULT current_timestamp(),
  `user_id` int(11) DEFAULT NULL,
  `actor_type` varchar(20) NOT NULL DEFAULT 'staff',
  `action` varchar(50) NOT NULL,
  `entity_type` varchar(50) NOT NULL,
  `entity_id` varchar(64) DEFAULT NULL,
  `before_json` longtext DEFAULT NULL,
  `after_json` longtext DEFAULT NULL,
  `ip` varchar(45) DEFAULT NULL,
  `user_agent` varchar(255) DEFAULT NULL,
  `request_url` varchar(500) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ts` (`ts`),
  KEY `idx_entity` (`entity_type`,`entity_id`),
  KEY `idx_user` (`user_id`,`ts`),
  KEY `idx_action` (`action`,`ts`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `billing_estimate_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `billing_estimate_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `estimate_id` int(11) NOT NULL,
  `zoho_item_id` varchar(50) DEFAULT NULL,
  `item_name` varchar(255) NOT NULL,
  `pack_size` varchar(100) DEFAULT NULL,
  `quantity` decimal(10,2) NOT NULL DEFAULT 1.00,
  `unit_price` decimal(10,2) NOT NULL DEFAULT 0.00,
  `line_total` decimal(12,2) NOT NULL DEFAULT 0.00,
  `display_order` int(11) DEFAULT 0,
  `deleted_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_estimate_id` (`estimate_id`),
  KEY `idx_billing_estimate_items_deleted_at` (`deleted_at`),
  CONSTRAINT `billing_estimate_items_ibfk_1` FOREIGN KEY (`estimate_id`) REFERENCES `billing_estimates` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `billing_estimates`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `billing_estimates` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `estimate_number` varchar(20) NOT NULL,
  `created_by` int(11) NOT NULL,
  `branch_id` int(11) NOT NULL,
  `customer_type` enum('customer','painter') NOT NULL,
  `customer_id` int(11) DEFAULT NULL,
  `painter_id` int(11) DEFAULT NULL,
  `customer_name` varchar(255) NOT NULL,
  `customer_phone` varchar(20) DEFAULT NULL,
  `customer_address` text DEFAULT NULL,
  `subtotal` decimal(12,2) DEFAULT 0.00,
  `discount_amount` decimal(12,2) DEFAULT 0.00,
  `grand_total` decimal(12,2) DEFAULT 0.00,
  `status` enum('draft','sent','approved','converted','cancelled') DEFAULT 'draft',
  `converted_to_invoice_id` int(11) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `valid_until` date DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `estimate_number` (`estimate_number`),
  KEY `idx_status` (`status`),
  KEY `idx_created_by` (`created_by`),
  KEY `idx_branch_id` (`branch_id`),
  KEY `idx_customer_type` (`customer_type`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `billing_invoice_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `billing_invoice_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `invoice_id` int(11) NOT NULL,
  `zoho_item_id` varchar(50) DEFAULT NULL,
  `item_name` varchar(255) NOT NULL,
  `pack_size` varchar(100) DEFAULT NULL,
  `quantity` decimal(10,2) NOT NULL DEFAULT 1.00,
  `unit_price` decimal(10,2) NOT NULL DEFAULT 0.00,
  `line_total` decimal(12,2) NOT NULL DEFAULT 0.00,
  `display_order` int(11) DEFAULT 0,
  `deleted_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_invoice_id` (`invoice_id`),
  KEY `idx_billing_invoice_items_deleted_at` (`deleted_at`),
  CONSTRAINT `billing_invoice_items_ibfk_1` FOREIGN KEY (`invoice_id`) REFERENCES `billing_invoices` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `billing_invoices`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `billing_invoices` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `invoice_number` varchar(20) NOT NULL,
  `created_by` int(11) NOT NULL,
  `branch_id` int(11) NOT NULL,
  `source` enum('direct','estimate') DEFAULT 'direct',
  `estimate_id` int(11) DEFAULT NULL,
  `customer_type` varchar(50) DEFAULT 'individual',
  `customer_id` int(11) DEFAULT NULL,
  `painter_id` int(11) DEFAULT NULL,
  `customer_name` varchar(255) NOT NULL,
  `customer_phone` varchar(20) DEFAULT NULL,
  `customer_address` text DEFAULT NULL,
  `subtotal` decimal(12,2) DEFAULT 0.00,
  `discount_amount` decimal(12,2) DEFAULT 0.00,
  `grand_total` decimal(12,2) DEFAULT 0.00,
  `amount_paid` decimal(12,2) DEFAULT 0.00,
  `balance_due` decimal(12,2) DEFAULT 0.00,
  `payment_status` enum('unpaid','partial','paid') DEFAULT 'unpaid',
  `zoho_status` enum('pending','pushed','failed') DEFAULT 'pending',
  `zoho_invoice_id` varchar(50) DEFAULT NULL,
  `zoho_invoice_number` varchar(50) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `invoice_number` (`invoice_number`),
  KEY `idx_payment_status` (`payment_status`),
  KEY `idx_zoho_status` (`zoho_status`),
  KEY `idx_created_by` (`created_by`),
  KEY `idx_branch_id` (`branch_id`),
  KEY `idx_customer_type` (`customer_type`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `billing_payments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `billing_payments` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `invoice_id` int(11) NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `payment_method` enum('cash','upi','bank_transfer','cheque','credit') NOT NULL,
  `payment_reference` varchar(100) DEFAULT NULL,
  `received_by` int(11) NOT NULL,
  `notes` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_invoice_id` (`invoice_id`),
  KEY `idx_received_by` (`received_by`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `billing_payments_ibfk_1` FOREIGN KEY (`invoice_id`) REFERENCES `billing_invoices` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `branch_item_sales`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `branch_item_sales` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `local_branch_id` int(11) NOT NULL,
  `zoho_item_id` varchar(50) NOT NULL,
  `sale_date` date NOT NULL,
  `qty_sold` decimal(12,2) NOT NULL DEFAULT 0.00,
  `revenue` decimal(12,2) NOT NULL DEFAULT 0.00,
  `invoice_count` int(11) NOT NULL DEFAULT 0,
  `synced_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_bis` (`local_branch_id`,`zoho_item_id`,`sale_date`),
  KEY `idx_item_date` (`zoho_item_id`,`sale_date`),
  KEY `idx_branch_date` (`local_branch_id`,`sale_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `branches`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `branches` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `code` varchar(10) NOT NULL,
  `address` text DEFAULT NULL,
  `city` varchar(100) DEFAULT NULL,
  `state` varchar(100) DEFAULT NULL,
  `pincode` varchar(10) DEFAULT NULL,
  `phone` varchar(15) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  `gst_number` varchar(20) DEFAULT NULL,
  `manager_user_id` int(11) DEFAULT NULL,
  `status` enum('active','inactive') DEFAULT 'active',
  `opened_date` date DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `latitude` decimal(10,8) DEFAULT NULL,
  `longitude` decimal(11,8) DEFAULT NULL,
  `geo_fence_radius_meters` int(11) DEFAULT 200,
  `open_time` time DEFAULT '08:30:00',
  `close_time` time DEFAULT '20:30:00',
  `zoho_location_id` varchar(50) DEFAULT NULL,
  `geo_fence_radius` int(11) DEFAULT 500,
  `data_integrity_score` decimal(3,2) DEFAULT 1.00,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`),
  KEY `idx_status` (`status`),
  KEY `idx_code` (`code`),
  KEY `idx_branches_manager` (`manager_user_id`),
  KEY `idx_branches_zoho_loc` (`zoho_location_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `brand_dpl_lists`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `brand_dpl_lists` (
  `brand` varchar(50) NOT NULL,
  `raw_text` mediumtext NOT NULL,
  `parsed_rows` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`parsed_rows`)),
  `parsed_count` int(11) NOT NULL,
  `effective_date` date DEFAULT NULL,
  `updated_by` varchar(100) DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`brand`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `brand_reorder_config`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `brand_reorder_config` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `brand_name` varchar(100) NOT NULL,
  `lead_time_days` int(11) NOT NULL DEFAULT 7,
  `safety_days` int(11) NOT NULL DEFAULT 5,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `updated_by` int(11) DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_brand` (`brand_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `brands`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `brands` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `logo_url` varchar(255) DEFAULT NULL,
  `status` enum('active','inactive') DEFAULT 'active',
  `visible_to_guest` tinyint(1) DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `bug_reports`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `bug_reports` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `title` varchar(500) NOT NULL,
  `description` text DEFAULT NULL,
  `steps_to_reproduce` text DEFAULT NULL,
  `expected_behavior` text DEFAULT NULL,
  `actual_behavior` text DEFAULT NULL,
  `module` varchar(100) DEFAULT NULL,
  `priority` enum('critical','high','medium','low') DEFAULT 'medium',
  `status` enum('open','investigating','in_progress','fixed','closed','wont_fix') DEFAULT 'open',
  `reported_by` int(11) DEFAULT NULL,
  `assigned_to` int(11) DEFAULT NULL,
  `related_error_id` int(11) DEFAULT NULL,
  `error_hash` varchar(64) DEFAULT NULL,
  `environment` varchar(50) DEFAULT 'production',
  `browser_info` varchar(500) DEFAULT NULL,
  `resolution_notes` text DEFAULT NULL,
  `fix_commit` varchar(100) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `resolved_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_bug_status` (`status`),
  KEY `idx_bug_priority` (`priority`),
  KEY `idx_bug_module` (`module`),
  KEY `idx_bug_assigned` (`assigned_to`),
  KEY `idx_bug_error_hash` (`error_hash`),
  KEY `idx_bug_created` (`created_at`),
  KEY `idx_br_related_error` (`related_error_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `categories`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `categories` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `description` text DEFAULT NULL,
  `status` enum('active','inactive') DEFAULT 'active',
  `visible_to_guest` tinyint(1) DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `chat_conversations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `chat_conversations` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `type` enum('direct','group') NOT NULL DEFAULT 'direct',
  `title` varchar(255) DEFAULT NULL,
  `created_by` int(11) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_created_by` (`created_by`),
  KEY `idx_updated_at` (`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `chat_messages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `chat_messages` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `conversation_id` int(11) NOT NULL,
  `sender_id` int(11) NOT NULL,
  `message_type` enum('text','image','file','system') NOT NULL DEFAULT 'text',
  `content` text NOT NULL,
  `file_url` varchar(512) DEFAULT NULL,
  `file_name` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_conversation_id` (`conversation_id`),
  KEY `idx_sender_id` (`sender_id`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `chat_messages_ibfk_1` FOREIGN KEY (`conversation_id`) REFERENCES `chat_conversations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `chat_participants`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `chat_participants` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `conversation_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `last_read_at` timestamp NULL DEFAULT NULL,
  `joined_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_conv_user` (`conversation_id`,`user_id`),
  KEY `idx_user_id` (`user_id`),
  CONSTRAINT `chat_participants_ibfk_1` FOREIGN KEY (`conversation_id`) REFERENCES `chat_conversations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `chat_read_receipts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `chat_read_receipts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `message_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `read_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_msg_user` (`message_id`,`user_id`),
  KEY `idx_user_id` (`user_id`),
  CONSTRAINT `chat_read_receipts_ibfk_1` FOREIGN KEY (`message_id`) REFERENCES `chat_messages` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `code_quality_metrics`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `code_quality_metrics` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `file_path` varchar(500) NOT NULL,
  `function_name` varchar(100) DEFAULT NULL,
  `complexity_score` int(11) DEFAULT NULL,
  `lines_of_code` int(11) DEFAULT NULL,
  `test_coverage` decimal(5,2) DEFAULT NULL,
  `last_modified` timestamp NULL DEFAULT NULL,
  `issues` longtext DEFAULT NULL CHECK (json_valid(`issues`)),
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_file_path` (`file_path`),
  KEY `idx_complexity` (`complexity_score`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `collection_reminders`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `collection_reminders` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `zoho_invoice_id` varchar(50) NOT NULL,
  `zoho_customer_id` varchar(50) NOT NULL,
  `customer_name` varchar(255) DEFAULT NULL,
  `phone` varchar(50) DEFAULT NULL,
  `reminder_type` enum('whatsapp','call','visit','email') DEFAULT 'whatsapp',
  `message_content` text DEFAULT NULL,
  `whatsapp_queue_id` int(11) DEFAULT NULL,
  `status` enum('sent','delivered','read','failed','pending') DEFAULT 'pending',
  `sent_at` datetime DEFAULT NULL,
  `sent_by` int(11) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `branch_id` int(11) DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_cr_customer` (`zoho_customer_id`),
  KEY `idx_cr_invoice` (`zoho_invoice_id`),
  KEY `sent_by` (`sent_by`),
  KEY `idx_cr_branch` (`branch_id`),
  KEY `idx_cr_wa_queue` (`whatsapp_queue_id`),
  CONSTRAINT `collection_reminders_ibfk_1` FOREIGN KEY (`sent_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `color_design_requests`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `color_design_requests` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `request_number` varchar(20) NOT NULL,
  `name` varchar(100) NOT NULL,
  `mobile` varchar(15) NOT NULL,
  `city` varchar(100) DEFAULT NULL,
  `photo_path` varchar(255) DEFAULT NULL,
  `status` enum('new','in_progress','completed','rejected') DEFAULT 'new',
  `admin_notes` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `request_number` (`request_number`),
  KEY `idx_status` (`status`),
  KEY `idx_mobile` (`mobile`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `credit_limit_requests`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `credit_limit_requests` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `branch_id` int(11) NOT NULL,
  `requested_by` int(11) NOT NULL,
  `zoho_customer_map_id` int(11) NOT NULL,
  `customer_name` varchar(255) DEFAULT NULL,
  `requested_amount` decimal(12,2) NOT NULL,
  `reason` text DEFAULT NULL,
  `status` enum('pending','approved','rejected') DEFAULT 'pending',
  `approved_amount` decimal(12,2) DEFAULT NULL,
  `reviewed_by` int(11) DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  `review_notes` text DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_status` (`status`),
  KEY `idx_branch` (`branch_id`),
  KEY `idx_customer` (`zoho_customer_map_id`),
  KEY `idx_requested_by` (`requested_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `credit_limit_violations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `credit_limit_violations` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `customer_id` int(11) NOT NULL,
  `zoho_customer_map_id` int(11) DEFAULT NULL,
  `invoice_number` varchar(100) DEFAULT NULL,
  `attempted_amount` decimal(12,2) NOT NULL,
  `credit_limit` decimal(12,2) NOT NULL,
  `credit_used` decimal(12,2) NOT NULL,
  `available_credit` decimal(12,2) NOT NULL,
  `staff_id` int(11) DEFAULT NULL,
  `branch_id` int(11) DEFAULT NULL,
  `action_taken` varchar(50) DEFAULT 'blocked',
  `created_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_customer` (`customer_id`),
  KEY `idx_date` (`created_at`),
  KEY `idx_staff` (`staff_id`),
  KEY `idx_clv_zoho` (`zoho_customer_map_id`),
  KEY `idx_clv_branch` (`branch_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `customer_credit_history`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `customer_credit_history` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `customer_id` int(11) NOT NULL DEFAULT 0,
  `zoho_customer_map_id` int(11) DEFAULT NULL,
  `previous_limit` decimal(12,2) DEFAULT 0.00,
  `new_limit` decimal(12,2) NOT NULL,
  `changed_by` int(11) NOT NULL,
  `reason` varchar(500) DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_customer` (`customer_id`),
  KEY `idx_date` (`created_at`),
  KEY `idx_cch_zoho` (`zoho_customer_map_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `customer_sessions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `customer_sessions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `token_hash` char(64) NOT NULL,
  `customer_id` int(11) DEFAULT NULL,
  `phone` varchar(20) NOT NULL,
  `expires_at` datetime NOT NULL,
  `revoked_at` datetime DEFAULT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `user_agent` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `token_hash` (`token_hash`),
  KEY `idx_phone` (`phone`),
  KEY `idx_expires_at` (`expires_at`),
  KEY `idx_customer_id` (`customer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `customer_types`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `customer_types` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(50) NOT NULL,
  `description` text DEFAULT NULL,
  `default_discount` decimal(5,2) DEFAULT 0.00,
  `price_markup` decimal(5,2) DEFAULT 0.00,
  `status` enum('active','inactive') DEFAULT 'active',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `customers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `customers` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `phone` varchar(15) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  `address` text DEFAULT NULL,
  `city` varchar(100) DEFAULT NULL,
  `gst_number` varchar(50) DEFAULT NULL,
  `status` enum('pending','approved','inactive') DEFAULT 'pending',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `branch_id` int(11) DEFAULT 1,
  `created_by` int(11) DEFAULT NULL,
  `customer_type_id` int(11) DEFAULT 1,
  `auto_discount_percent` decimal(5,2) DEFAULT 0.00,
  `password_hash` varchar(255) DEFAULT NULL,
  `is_verified` tinyint(1) DEFAULT 0,
  `lead_id` int(11) DEFAULT NULL,
  `whatsapp_opt_in` tinyint(1) DEFAULT 0,
  `total_purchases` decimal(12,2) DEFAULT 0.00,
  `notes` text DEFAULT NULL,
  `credit_limit` decimal(12,2) DEFAULT 0.00 COMMENT 'Maximum credit allowed',
  `credit_used` decimal(12,2) DEFAULT 0.00 COMMENT 'Currently used credit (outstanding balance)',
  `credit_limit_updated_at` datetime DEFAULT NULL,
  `credit_limit_updated_by` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_phone` (`phone`),
  KEY `idx_status` (`status`),
  KEY `idx_branch` (`branch_id`),
  KEY `idx_cust_type` (`customer_type_id`),
  KEY `idx_cust_lead` (`lead_id`),
  KEY `idx_credit_limit` (`credit_limit`),
  KEY `idx_credit_used` (`credit_used`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `daily_task_materials`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `daily_task_materials` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `response_id` int(11) NOT NULL,
  `vendor_name` varchar(255) NOT NULL,
  `photo_url` varchar(500) DEFAULT NULL,
  `bill_on_zoho` tinyint(1) DEFAULT 0,
  `notes` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_response` (`response_id`),
  CONSTRAINT `daily_task_materials_ibfk_1` FOREIGN KEY (`response_id`) REFERENCES `daily_task_responses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `daily_task_responses`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `daily_task_responses` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `task_date` date NOT NULL,
  `template_id` int(11) NOT NULL,
  `answer` enum('yes','no') DEFAULT NULL,
  `reason` text DEFAULT NULL,
  `details` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`details`)),
  `photos` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`photos`)),
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_user_date_template` (`user_id`,`task_date`,`template_id`),
  KEY `idx_user_date` (`user_id`,`task_date`),
  KEY `idx_date` (`task_date`),
  KEY `template_id` (`template_id`),
  CONSTRAINT `daily_task_responses_ibfk_1` FOREIGN KEY (`template_id`) REFERENCES `daily_task_templates` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `daily_task_submissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `daily_task_submissions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `task_date` date NOT NULL,
  `total_tasks` int(11) DEFAULT 0,
  `completed_tasks` int(11) DEFAULT 0,
  `submitted_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_user_date` (`user_id`,`task_date`),
  KEY `idx_date` (`task_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `daily_task_templates`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `daily_task_templates` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `section` varchar(50) NOT NULL,
  `title` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `task_type` enum('yes_no','yes_no_photo','yes_no_detail','material_received') NOT NULL DEFAULT 'yes_no',
  `detail_fields` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`detail_fields`)),
  `roles` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`roles`)),
  `photo_required` tinyint(1) DEFAULT 0,
  `sort_order` int(11) DEFAULT 0,
  `is_active` tinyint(1) DEFAULT 1,
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_section` (`section`),
  KEY `idx_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `design_visualizations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `design_visualizations` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `design_request_id` int(11) NOT NULL,
  `brand` varchar(50) NOT NULL,
  `color_code` varchar(20) NOT NULL,
  `color_name` varchar(100) NOT NULL,
  `color_hex` varchar(7) NOT NULL,
  `visualization_path` varchar(255) NOT NULL,
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_design_request` (`design_request_id`),
  KEY `idx_brand_color` (`brand`,`color_code`),
  CONSTRAINT `design_visualizations_ibfk_1` FOREIGN KEY (`design_request_id`) REFERENCES `color_design_requests` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `detected_anomalies`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `detected_anomalies` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `anomaly_type` enum('revenue','attendance','stock','collection','api_usage','custom') NOT NULL,
  `severity` enum('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  `title` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `entity_type` varchar(100) DEFAULT NULL COMMENT 'e.g. branch, user, item, customer',
  `entity_id` varchar(100) DEFAULT NULL COMMENT 'ID of the related entity',
  `metric_name` varchar(150) DEFAULT NULL COMMENT 'e.g. daily_revenue, clock_in_time',
  `expected_value` decimal(15,2) DEFAULT NULL,
  `actual_value` decimal(15,2) DEFAULT NULL,
  `deviation_pct` decimal(8,2) DEFAULT NULL COMMENT 'Percentage deviation from expected',
  `z_score` decimal(8,4) DEFAULT NULL COMMENT 'Statistical Z-score',
  `status` enum('new','acknowledged','investigating','resolved','false_positive') NOT NULL DEFAULT 'new',
  `branch_id` int(11) DEFAULT NULL,
  `resolved_at` datetime DEFAULT NULL,
  `resolved_by` int(11) DEFAULT NULL,
  `resolution_notes` text DEFAULT NULL,
  `metadata` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT 'Additional context data' CHECK (json_valid(`metadata`)),
  `detected_at` datetime NOT NULL DEFAULT current_timestamp(),
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_anomaly_type` (`anomaly_type`),
  KEY `idx_severity` (`severity`),
  KEY `idx_status` (`status`),
  KEY `idx_branch_id` (`branch_id`),
  KEY `idx_detected_at` (`detected_at`),
  KEY `idx_type_status` (`anomaly_type`,`status`),
  KEY `idx_severity_status` (`severity`,`status`),
  KEY `idx_da_entity` (`entity_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `discount_requests`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `discount_requests` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `estimate_id` int(11) DEFAULT NULL,
  `customer_id` int(11) DEFAULT NULL,
  `requested_percent` decimal(5,2) DEFAULT NULL,
  `reason` text DEFAULT NULL,
  `status` enum('pending','approved','rejected') DEFAULT 'pending',
  `approved_percent` decimal(5,2) DEFAULT NULL,
  `approved_by` int(11) DEFAULT NULL,
  `approved_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `customer_id` (`customer_id`),
  KEY `approved_by` (`approved_by`),
  KEY `idx_status` (`status`),
  KEY `idx_estimate` (`estimate_id`),
  CONSTRAINT `discount_requests_ibfk_1` FOREIGN KEY (`estimate_id`) REFERENCES `estimates` (`id`) ON DELETE CASCADE,
  CONSTRAINT `discount_requests_ibfk_2` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`),
  CONSTRAINT `discount_requests_ibfk_3` FOREIGN KEY (`approved_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `dpl_catalog`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `dpl_catalog` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `brand` varchar(40) NOT NULL,
  `match_key` varchar(255) NOT NULL,
  `category` varchar(120) DEFAULT NULL,
  `product_code` varchar(20) DEFAULT NULL,
  `product_name` varchar(160) NOT NULL,
  `base_name` varchar(80) DEFAULT NULL,
  `size_tier` varchar(12) NOT NULL,
  `dpl_size_label` varchar(20) DEFAULT NULL,
  `zoho_item_id` varchar(40) DEFAULT NULL,
  `canonical_name` varchar(255) DEFAULT NULL,
  `canonical_sku` varchar(64) DEFAULT NULL,
  `canonical_description` varchar(255) DEFAULT NULL,
  `current_dpl` decimal(12,2) DEFAULT NULL,
  `current_rate` decimal(12,2) DEFAULT NULL,
  `link_status` enum('confirmed','review','needs_creating') NOT NULL DEFAULT 'review',
  `link_confidence` tinyint(4) DEFAULT NULL,
  `link_reason` varchar(120) DEFAULT NULL,
  `updated_by` varchar(100) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `pushed_at` timestamp NULL DEFAULT NULL,
  `pushed_job_id` int(11) DEFAULT NULL,
  `pushed_dpl` decimal(12,2) DEFAULT NULL,
  `pushed_rate` decimal(12,2) DEFAULT NULL,
  `not_in_zoho` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_match_key` (`match_key`),
  KEY `idx_brand` (`brand`),
  KEY `idx_zoho_item` (`zoho_item_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `dpl_price_history`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `dpl_price_history` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `zoho_item_id` varchar(100) NOT NULL,
  `dpl_version_id` int(11) DEFAULT NULL,
  `old_dpl` decimal(10,2) DEFAULT NULL,
  `new_dpl` decimal(10,2) DEFAULT NULL,
  `old_purchase_rate` decimal(10,2) DEFAULT NULL,
  `new_purchase_rate` decimal(10,2) DEFAULT NULL,
  `old_sales_rate` decimal(10,2) DEFAULT NULL,
  `new_sales_rate` decimal(10,2) DEFAULT NULL,
  `changed_at` timestamp NULL DEFAULT current_timestamp(),
  `changed_by` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_item` (`zoho_item_id`),
  KEY `idx_version` (`dpl_version_id`),
  KEY `idx_changed_at` (`changed_at`),
  CONSTRAINT `dpl_price_history_ibfk_1` FOREIGN KEY (`dpl_version_id`) REFERENCES `dpl_versions` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `dpl_versions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `dpl_versions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `brand` varchar(100) NOT NULL,
  `version_label` varchar(50) DEFAULT NULL,
  `effective_date` date NOT NULL,
  `pdf_path` varchar(500) DEFAULT NULL,
  `notebooklm_notebook_id` varchar(100) DEFAULT NULL,
  `total_items` int(11) DEFAULT 0,
  `matched_items` int(11) DEFAULT 0,
  `status` enum('draft','active','archived') DEFAULT 'draft',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_brand` (`brand`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `engineer_custom_rates`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `engineer_custom_rates` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `engineer_id` int(11) NOT NULL,
  `scope` enum('item','brand','category') NOT NULL,
  `target_id` varchar(150) NOT NULL,
  `zoho_item_id` varchar(50) DEFAULT NULL,
  `discount_pct` decimal(5,2) NOT NULL DEFAULT 0.00,
  `notes` varchar(500) DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_engineer_scope_target` (`engineer_id`,`scope`,`target_id`),
  KEY `idx_engineer` (`engineer_id`),
  KEY `idx_scope` (`scope`),
  KEY `idx_zoho_item` (`zoho_item_id`),
  CONSTRAINT `engineer_custom_rates_ibfk_1` FOREIGN KEY (`engineer_id`) REFERENCES `engineers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `engineer_default_rates`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `engineer_default_rates` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `scope` enum('item','brand','category') NOT NULL,
  `target_id` varchar(150) NOT NULL,
  `zoho_item_id` varchar(50) DEFAULT NULL,
  `discount_pct` decimal(5,2) NOT NULL DEFAULT 0.00,
  `notes` varchar(500) DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_scope_target` (`scope`,`target_id`),
  KEY `idx_scope` (`scope`),
  KEY `idx_zoho_item` (`zoho_item_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `engineer_hidden_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `engineer_hidden_items` (
  `zoho_item_id` varchar(50) NOT NULL,
  `reason` varchar(500) DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`zoho_item_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `engineer_sessions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `engineer_sessions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `engineer_id` int(11) NOT NULL,
  `token` varchar(255) DEFAULT NULL,
  `token_hash` varchar(64) DEFAULT NULL,
  `otp` varchar(64) DEFAULT NULL,
  `otp_expires_at` datetime DEFAULT NULL,
  `device_info` varchar(255) DEFAULT NULL,
  `expires_at` datetime NOT NULL,
  `last_used_at` timestamp NULL DEFAULT current_timestamp(),
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `otp_attempts` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_token_hash` (`token_hash`),
  KEY `idx_engineer` (`engineer_id`),
  KEY `idx_expires` (`expires_at`),
  CONSTRAINT `engineer_sessions_ibfk_1` FOREIGN KEY (`engineer_id`) REFERENCES `engineers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `engineers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `engineers` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `full_name` varchar(255) NOT NULL,
  `phone` varchar(20) NOT NULL,
  `email` varchar(255) DEFAULT NULL,
  `company_name` varchar(255) DEFAULT NULL,
  `designation` varchar(100) DEFAULT NULL,
  `gst_number` varchar(20) DEFAULT NULL,
  `pan_number` varchar(20) DEFAULT NULL,
  `address` text DEFAULT NULL,
  `city` varchar(100) DEFAULT NULL,
  `district` varchar(100) DEFAULT NULL,
  `state` varchar(100) DEFAULT 'Tamil Nadu',
  `pincode` varchar(10) DEFAULT NULL,
  `branch_id` int(11) DEFAULT NULL,
  `profile_photo` varchar(500) DEFAULT NULL,
  `status` enum('pending','approved','suspended','rejected') DEFAULT 'pending',
  `credit_enabled` tinyint(1) DEFAULT 0,
  `credit_limit` decimal(12,2) DEFAULT 0.00,
  `credit_used` decimal(12,2) DEFAULT 0.00,
  `total_spend` decimal(12,2) DEFAULT 0.00,
  `notes` text DEFAULT NULL,
  `approved_by` int(11) DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `rejected_reason` varchar(500) DEFAULT NULL,
  `zoho_contact_id` varchar(50) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `phone` (`phone`),
  KEY `idx_phone` (`phone`),
  KEY `idx_status` (`status`),
  KEY `idx_branch` (`branch_id`),
  KEY `idx_company` (`company_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `error_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `error_logs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `error_type` enum('database','api','frontend','validation','authentication','authorization','integration') NOT NULL,
  `error_code` varchar(50) DEFAULT NULL,
  `error_message` text NOT NULL,
  `stack_trace` text DEFAULT NULL,
  `request_url` varchar(500) DEFAULT NULL,
  `request_method` varchar(10) DEFAULT NULL,
  `request_body` longtext DEFAULT NULL CHECK (json_valid(`request_body`)),
  `user_id` int(11) DEFAULT NULL,
  `session_id` varchar(100) DEFAULT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `user_agent` text DEFAULT NULL,
  `severity` enum('low','medium','high','critical') DEFAULT 'medium',
  `status` enum('new','investigating','resolved','ignored') DEFAULT 'new',
  `resolution_notes` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `resolved_at` timestamp NULL DEFAULT NULL,
  `frequency_count` int(11) DEFAULT 1,
  `error_hash` varchar(64) DEFAULT NULL,
  `file_path` varchar(500) DEFAULT NULL,
  `line_number` int(11) DEFAULT NULL,
  `function_name` varchar(200) DEFAULT NULL,
  `branch_id` int(11) DEFAULT NULL,
  `last_occurrence` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_error_type` (`error_type`),
  KEY `idx_severity` (`severity`),
  KEY `idx_status` (`status`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_error_hash` (`error_hash`),
  KEY `idx_error_logs_user` (`user_id`),
  KEY `idx_error_logs_branch` (`branch_id`),
  KEY `idx_error_logs_session` (`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `estimate_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `estimate_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `estimate_id` int(11) NOT NULL,
  `item_type` enum('product','labor') DEFAULT 'product',
  `product_id` int(11) DEFAULT NULL,
  `zoho_item_id` varchar(100) DEFAULT NULL,
  `item_name` varchar(255) DEFAULT NULL,
  `brand` varchar(100) DEFAULT NULL,
  `category` varchar(100) DEFAULT NULL,
  `pack_size` varchar(50) DEFAULT NULL,
  `product_type` enum('unit','area') DEFAULT NULL,
  `custom_description` text DEFAULT NULL,
  `show_description_only` tinyint(4) DEFAULT NULL,
  `image_url` varchar(500) DEFAULT NULL,
  `item_description` varchar(255) DEFAULT NULL,
  `quantity` decimal(10,2) NOT NULL,
  `area` decimal(10,2) DEFAULT NULL,
  `num_coats` int(11) DEFAULT 1,
  `base_price` decimal(12,2) DEFAULT NULL,
  `markup_type` enum('price_pct','price_value','total_pct','total_value') DEFAULT NULL,
  `markup_value` decimal(12,2) DEFAULT 0.00,
  `markup_amount` decimal(12,2) DEFAULT 0.00,
  `price_after_markup` decimal(12,2) DEFAULT NULL,
  `discount_type` enum('price_pct','price_value','total_pct','total_value') DEFAULT NULL,
  `discount_value` decimal(12,2) DEFAULT 0.00,
  `discount_amount` decimal(12,2) DEFAULT 0.00,
  `final_price` decimal(12,2) DEFAULT NULL,
  `mix_info` text DEFAULT NULL,
  `unit_price` decimal(10,2) NOT NULL,
  `breakdown_cost` text DEFAULT NULL,
  `color_cost` decimal(10,2) DEFAULT 0.00,
  `line_total` decimal(12,2) NOT NULL,
  `display_order` int(11) DEFAULT 0,
  `labor_description` varchar(255) DEFAULT NULL,
  `labor_taxable` tinyint(4) DEFAULT 1,
  `hide_price` tinyint(4) DEFAULT 0,
  `is_visible` tinyint(1) DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `deleted_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `estimate_id` (`estimate_id`),
  KEY `product_id` (`product_id`),
  KEY `idx_estimate_items_deleted_at` (`deleted_at`),
  CONSTRAINT `estimate_items_ibfk_1` FOREIGN KEY (`estimate_id`) REFERENCES `estimates` (`id`) ON DELETE CASCADE,
  CONSTRAINT `estimate_items_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `estimate_request_activity`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `estimate_request_activity` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `request_id` int(11) NOT NULL,
  `user_id` int(11) DEFAULT NULL,
  `action` varchar(100) NOT NULL COMMENT 'created, contacted, quote_sent, status_changed, assigned, note_added',
  `old_value` text DEFAULT NULL,
  `new_value` text DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_request_id` (`request_id`),
  KEY `idx_created_at` (`created_at`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `estimate_request_activity_ibfk_1` FOREIGN KEY (`request_id`) REFERENCES `estimate_requests` (`id`) ON DELETE CASCADE,
  CONSTRAINT `estimate_request_activity_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `estimate_request_photos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `estimate_request_photos` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `request_id` int(11) NOT NULL,
  `photo_url` text NOT NULL,
  `photo_type` varchar(50) DEFAULT NULL COMMENT 'interior, exterior, specific_area',
  `caption` text DEFAULT NULL,
  `uploaded_at` datetime DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_request_id` (`request_id`),
  CONSTRAINT `estimate_request_photos_ibfk_1` FOREIGN KEY (`request_id`) REFERENCES `estimate_requests` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `estimate_request_products`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `estimate_request_products` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `request_id` int(11) NOT NULL,
  `product_id` int(11) NOT NULL,
  `product_name` varchar(255) NOT NULL,
  `calculation_type` enum('unit','sqft') NOT NULL,
  `pack_size` varchar(50) DEFAULT NULL,
  `quantity` int(11) DEFAULT NULL,
  `area_sqft` int(11) DEFAULT NULL,
  `coats` int(11) DEFAULT NULL,
  `calculated_liters` decimal(10,2) DEFAULT NULL,
  `raw_data` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`raw_data`)),
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_request_id` (`request_id`),
  KEY `idx_product_id` (`product_id`),
  CONSTRAINT `estimate_request_products_ibfk_1` FOREIGN KEY (`request_id`) REFERENCES `estimate_requests` (`id`) ON DELETE CASCADE,
  CONSTRAINT `estimate_request_products_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `estimate_requests`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `estimate_requests` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `request_number` varchar(50) NOT NULL,
  `customer_name` varchar(255) NOT NULL,
  `phone` varchar(15) NOT NULL,
  `email` varchar(255) DEFAULT NULL,
  `project_type` enum('interior','exterior','both','commercial','renovation','new_construction') NOT NULL,
  `property_type` enum('house','apartment','villa','office','shop','warehouse','other') NOT NULL,
  `location` text NOT NULL,
  `area_sqft` int(11) NOT NULL,
  `rooms` int(11) DEFAULT NULL,
  `preferred_brand` varchar(100) DEFAULT NULL,
  `timeline` varchar(50) DEFAULT NULL,
  `budget_range` varchar(50) DEFAULT NULL,
  `additional_notes` text DEFAULT NULL,
  `products_json` longtext DEFAULT NULL,
  `status` enum('new','contacted','quote_sent','accepted','rejected','completed') DEFAULT 'new',
  `priority` enum('low','medium','high','urgent') DEFAULT 'medium',
  `assigned_to_user_id` int(11) DEFAULT NULL,
  `assigned_at` datetime DEFAULT NULL,
  `estimate_id` int(11) DEFAULT NULL COMMENT 'Link to created estimate',
  `estimated_amount` decimal(10,2) DEFAULT NULL,
  `source` varchar(50) DEFAULT 'website' COMMENT 'website, phone, whatsapp, referral',
  `request_method` enum('simple','product','product_available','product_custom') DEFAULT 'simple',
  `ip_address` varchar(45) DEFAULT NULL,
  `user_agent` text DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `contacted_at` datetime DEFAULT NULL,
  `quote_sent_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `request_number` (`request_number`),
  KEY `idx_phone` (`phone`),
  KEY `idx_status` (`status`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_assigned_to` (`assigned_to_user_id`),
  KEY `estimate_id` (`estimate_id`),
  CONSTRAINT `estimate_requests_ibfk_1` FOREIGN KEY (`assigned_to_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `estimate_requests_ibfk_2` FOREIGN KEY (`estimate_id`) REFERENCES `estimates` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `estimate_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `estimate_settings` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `default_column_visibility` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`default_column_visibility`)),
  `default_show_gst_breakdown` tinyint(1) DEFAULT 0,
  `default_valid_days` int(11) DEFAULT 30,
  `auto_assign_to_creator` tinyint(1) DEFAULT 1,
  `email_template` text DEFAULT NULL,
  `whatsapp_template` text DEFAULT NULL,
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_user_settings` (`user_id`),
  CONSTRAINT `estimate_settings_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `estimate_status_history`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `estimate_status_history` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `estimate_id` int(11) NOT NULL,
  `estimate_type` enum('legacy','painter') DEFAULT 'legacy',
  `old_status` varchar(50) DEFAULT NULL,
  `new_status` varchar(50) NOT NULL,
  `changed_by_user_id` int(11) NOT NULL,
  `reason` text DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `timestamp` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `changed_by_user_id` (`changed_by_user_id`),
  KEY `idx_estimate_id` (`estimate_id`),
  KEY `idx_timestamp` (`timestamp`),
  KEY `idx_est_type` (`estimate_id`,`estimate_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `estimates`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `estimates` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `estimate_number` varchar(50) NOT NULL,
  `customer_id` int(11) DEFAULT NULL,
  `customer_name` varchar(255) DEFAULT NULL,
  `customer_phone` varchar(15) DEFAULT NULL,
  `customer_address` text DEFAULT NULL,
  `estimate_date` date NOT NULL,
  `subtotal` decimal(12,2) NOT NULL,
  `gst_amount` decimal(12,2) DEFAULT 0.00,
  `discount_amount` decimal(12,2) DEFAULT 0.00,
  `grand_total` decimal(12,2) NOT NULL,
  `total_markup` decimal(12,2) DEFAULT 0.00,
  `total_discount` decimal(12,2) DEFAULT 0.00,
  `total_labor` decimal(12,2) DEFAULT 0.00,
  `show_gst_breakdown` tinyint(1) DEFAULT 1,
  `notes` text DEFAULT NULL,
  `admin_notes` text DEFAULT NULL,
  `show_description_only` tinyint(4) DEFAULT 0,
  `status` enum('draft','sent','approved','rejected','converted') DEFAULT 'draft',
  `created_by_user_id` int(11) DEFAULT NULL,
  `assigned_to_staff_id` int(11) DEFAULT NULL,
  `approved_by_admin_id` int(11) DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `converted_invoice_id` varchar(100) DEFAULT NULL,
  `converted_at` datetime DEFAULT NULL,
  `valid_until` date DEFAULT NULL,
  `is_expired` tinyint(1) DEFAULT 0,
  `column_visibility` longtext DEFAULT NULL CHECK (json_valid(`column_visibility`)),
  `last_updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `markup_percent` decimal(5,2) DEFAULT 0.00,
  `discount_percent` decimal(5,2) DEFAULT 0.00,
  `branch_id` int(11) DEFAULT 1,
  `payment_status` enum('unpaid','partial','paid') DEFAULT 'unpaid',
  `payment_method` varchar(50) DEFAULT NULL,
  `payment_reference` varchar(255) DEFAULT NULL,
  `payment_amount` decimal(12,2) DEFAULT 0.00,
  `payment_recorded_by` int(11) DEFAULT NULL,
  `payment_recorded_at` datetime DEFAULT NULL,
  `billing_invoice_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `estimate_number` (`estimate_number`),
  KEY `customer_id` (`customer_id`),
  KEY `idx_number` (`estimate_number`),
  KEY `idx_date` (`estimate_date`),
  KEY `idx_status` (`status`),
  KEY `created_by_user_id` (`created_by_user_id`),
  KEY `assigned_to_staff_id` (`assigned_to_staff_id`),
  KEY `approved_by_admin_id` (`approved_by_admin_id`),
  KEY `idx_branch` (`branch_id`),
  KEY `idx_est_conv_inv` (`converted_invoice_id`),
  KEY `idx_payment_status` (`payment_status`),
  CONSTRAINT `estimates_ibfk_1` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`),
  CONSTRAINT `estimates_ibfk_2` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `estimates_ibfk_3` FOREIGN KEY (`assigned_to_staff_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `estimates_ibfk_4` FOREIGN KEY (`approved_by_admin_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `fix_suggestions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `fix_suggestions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `error_id` int(11) DEFAULT NULL,
  `bug_report_id` int(11) DEFAULT NULL,
  `error_hash` varchar(64) DEFAULT NULL,
  `suggestion_type` enum('code_fix','config_change','data_fix','infrastructure','monitoring') DEFAULT 'code_fix',
  `title` varchar(500) NOT NULL,
  `description` text DEFAULT NULL,
  `suggested_fix` text DEFAULT NULL,
  `file_path` varchar(500) DEFAULT NULL,
  `confidence` decimal(5,2) DEFAULT 0.00,
  `complexity` enum('trivial','simple','moderate','complex') DEFAULT 'moderate',
  `ai_generated` tinyint(1) DEFAULT 0,
  `status` enum('pending','approved','applied','rejected') DEFAULT 'pending',
  `applied_by` int(11) DEFAULT NULL,
  `applied_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_fix_error` (`error_id`),
  KEY `idx_fix_bug` (`bug_report_id`),
  KEY `idx_fix_hash` (`error_hash`),
  KEY `idx_fix_status` (`status`),
  KEY `idx_fix_confidence` (`confidence`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `geofence_violations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `geofence_violations` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `branch_id` int(11) NOT NULL,
  `latitude` decimal(10,8) NOT NULL,
  `longitude` decimal(11,8) NOT NULL,
  `distance_from_fence` int(11) NOT NULL,
  `fence_radius` int(11) NOT NULL,
  `violation_type` enum('left_area','returned') NOT NULL DEFAULT 'left_area',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_branch_id` (`branch_id`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `geofence_violations_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `geofence_violations_ibfk_2` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `guide_categories`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `guide_categories` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `name_ta` varchar(100) DEFAULT NULL,
  `icon` varchar(50) DEFAULT '?',
  `sort_order` int(11) DEFAULT 0,
  `status` enum('active','inactive') DEFAULT 'active',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `guide_favorites`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `guide_favorites` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `guide_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_fav` (`guide_id`,`user_id`),
  CONSTRAINT `guide_favorites_ibfk_1` FOREIGN KEY (`guide_id`) REFERENCES `guides` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `guide_versions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `guide_versions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `guide_id` int(11) NOT NULL,
  `version` int(11) NOT NULL,
  `title` varchar(255) DEFAULT NULL,
  `title_ta` varchar(255) DEFAULT NULL,
  `content_en` longtext DEFAULT NULL,
  `content_ta` longtext DEFAULT NULL,
  `changed_by` int(11) DEFAULT NULL,
  `change_summary` varchar(500) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `guide_id` (`guide_id`),
  CONSTRAINT `guide_versions_ibfk_1` FOREIGN KEY (`guide_id`) REFERENCES `guides` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `guide_views`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `guide_views` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `guide_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `viewed_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_guide_views_guide` (`guide_id`),
  KEY `idx_guide_views_user` (`user_id`),
  CONSTRAINT `guide_views_ibfk_1` FOREIGN KEY (`guide_id`) REFERENCES `guides` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `guides`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `guides` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `category_id` int(11) DEFAULT NULL,
  `title` varchar(255) NOT NULL,
  `title_ta` varchar(255) DEFAULT NULL,
  `slug` varchar(255) DEFAULT NULL,
  `content_en` longtext DEFAULT NULL,
  `content_ta` longtext DEFAULT NULL,
  `summary` varchar(500) DEFAULT NULL,
  `summary_ta` varchar(500) DEFAULT NULL,
  `language` enum('en','ta','both') DEFAULT 'both',
  `content_type` enum('rich_text','full_html') DEFAULT 'rich_text',
  `status` enum('draft','published','archived') DEFAULT 'draft',
  `visible_to_staff` tinyint(1) DEFAULT 1,
  `author_id` int(11) DEFAULT NULL,
  `version` int(11) DEFAULT 1,
  `view_count` int(11) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_slug` (`slug`),
  KEY `category_id` (`category_id`),
  KEY `idx_guides_status` (`status`,`visible_to_staff`),
  KEY `idx_guides_author` (`author_id`),
  CONSTRAINT `guides_ibfk_1` FOREIGN KEY (`category_id`) REFERENCES `guide_categories` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `idempotency_records`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `idempotency_records` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `key_hash` char(64) NOT NULL,
  `scope` varchar(64) NOT NULL,
  `user_id` int(11) DEFAULT NULL,
  `actor_type` varchar(16) DEFAULT NULL,
  `response_status` int(11) NOT NULL,
  `response_body` longtext DEFAULT NULL,
  `request_url` varchar(512) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `expires_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `key_hash` (`key_hash`),
  KEY `idx_scope` (`scope`),
  KEY `idx_expires_at` (`expires_at`),
  KEY `idx_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `incentive_slabs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `incentive_slabs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `min_amount` decimal(12,2) NOT NULL,
  `max_amount` decimal(12,2) NOT NULL,
  `incentive_amount` decimal(10,2) NOT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_active_range` (`is_active`,`min_amount`,`max_amount`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `invoice_line_sync_cursor`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `invoice_line_sync_cursor` (
  `invoice_id` varchar(50) NOT NULL,
  `synced_at` timestamp NULL DEFAULT current_timestamp(),
  `line_count` int(11) DEFAULT NULL,
  PRIMARY KEY (`invoice_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `item_naming_rules`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `item_naming_rules` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `brand` varchar(100) NOT NULL,
  `category` varchar(100) NOT NULL,
  `category_code` varchar(5) NOT NULL,
  `product_name` varchar(255) NOT NULL,
  `product_short` varchar(10) NOT NULL,
  `has_base` tinyint(1) DEFAULT 0,
  `has_color` tinyint(1) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_brand_product` (`brand`,`product_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `item_vendor_map`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `item_vendor_map` (
  `zoho_item_id` varchar(50) NOT NULL,
  `vendor_id` int(11) NOT NULL,
  `bill_count` int(11) NOT NULL DEFAULT 0,
  `total_qty` decimal(14,3) NOT NULL DEFAULT 0.000,
  `last_bill_date` date DEFAULT NULL,
  `last_bill_rate` decimal(14,2) DEFAULT NULL,
  `first_bill_date` date DEFAULT NULL,
  `is_primary` tinyint(1) NOT NULL DEFAULT 0,
  `source` enum('auto','manual') NOT NULL DEFAULT 'auto',
  `pushed_to_zoho` tinyint(1) NOT NULL DEFAULT 0,
  `pushed_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`zoho_item_id`,`vendor_id`),
  KEY `idx_item` (`zoho_item_id`),
  KEY `idx_vendor` (`vendor_id`),
  KEY `idx_primary` (`zoho_item_id`,`is_primary`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `job_runs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `job_runs` (
  `job_name` varchar(64) NOT NULL,
  `period_label` varchar(32) NOT NULL,
  `ran_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`job_name`,`period_label`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `lead_conversion_predictions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `lead_conversion_predictions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `lead_id` int(11) NOT NULL,
  `conversion_probability` decimal(5,2) DEFAULT 0.00,
  `predicted_timeline` varchar(100) DEFAULT NULL,
  `confidence` decimal(5,2) DEFAULT 0.00,
  `factors_json` longtext DEFAULT NULL CHECK (json_valid(`factors_json`)),
  `ai_explanation` text DEFAULT NULL,
  `predicted_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_lcp_lead` (`lead_id`),
  KEY `idx_lcp_probability` (`conversion_probability`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `lead_followups`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `lead_followups` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `lead_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `followup_type` enum('call','visit','email','whatsapp','sms','meeting','other') NOT NULL,
  `notes` text NOT NULL,
  `outcome` enum('interested','not_interested','callback','no_response','converted','other','follow_up','scheduled','busy','wrong_number') DEFAULT 'other',
  `next_followup_date` date DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  KEY `idx_lead` (`lead_id`),
  KEY `idx_date` (`created_at`),
  CONSTRAINT `lead_followups_ibfk_1` FOREIGN KEY (`lead_id`) REFERENCES `leads` (`id`) ON DELETE CASCADE,
  CONSTRAINT `lead_followups_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `leads`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `leads` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `lead_number` varchar(50) DEFAULT NULL,
  `name` varchar(255) NOT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  `company` varchar(255) DEFAULT NULL,
  `address` text DEFAULT NULL,
  `city` varchar(100) DEFAULT NULL,
  `state` varchar(100) DEFAULT NULL,
  `pincode` varchar(10) DEFAULT NULL,
  `source` enum('website','walk_in','referral','social_media','phone_call','advertisement','other','phone','whatsapp') DEFAULT 'other',
  `project_type` enum('interior','exterior','both','commercial','industrial') DEFAULT 'interior',
  `property_type` enum('house','apartment','villa','office','shop','factory','other') DEFAULT 'house',
  `estimated_area_sqft` decimal(10,2) DEFAULT NULL,
  `estimated_budget` decimal(12,2) DEFAULT NULL,
  `preferred_brand` varchar(100) DEFAULT NULL,
  `timeline` varchar(100) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `status` enum('new','contacted','interested','quoted','negotiating','won','lost','inactive') DEFAULT 'new',
  `priority` enum('low','medium','high','urgent') DEFAULT 'medium',
  `assigned_to` int(11) DEFAULT NULL,
  `branch_id` int(11) DEFAULT NULL,
  `customer_id` int(11) DEFAULT NULL,
  `lead_type` enum('customer','painter','engineer') DEFAULT NULL,
  `converted_at` datetime DEFAULT NULL,
  `lost_reason` text DEFAULT NULL,
  `last_contact_date` date DEFAULT NULL,
  `next_followup_date` date DEFAULT NULL,
  `total_followups` int(11) DEFAULT 0,
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `lead_score` int(11) DEFAULT NULL,
  `lead_score_updated_at` timestamp NULL DEFAULT NULL,
  `validation_errors` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`validation_errors`)),
  `re_engaged_at` datetime DEFAULT NULL,
  `re_engage_count` int(11) DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `lead_number` (`lead_number`),
  KEY `branch_id` (`branch_id`),
  KEY `customer_id` (`customer_id`),
  KEY `created_by` (`created_by`),
  KEY `idx_status` (`status`),
  KEY `idx_priority` (`priority`),
  KEY `idx_assigned` (`assigned_to`),
  KEY `idx_phone` (`phone`),
  KEY `idx_created` (`created_at`),
  KEY `idx_lead_score` (`lead_score`),
  KEY `idx_leads_status_branch` (`status`,`branch_id`),
  KEY `idx_leads_assigned_status` (`assigned_to`,`status`),
  KEY `idx_leads_branch_status_followup` (`branch_id`,`status`,`next_followup_date`),
  CONSTRAINT `leads_ibfk_1` FOREIGN KEY (`assigned_to`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `leads_ibfk_2` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`) ON DELETE SET NULL,
  CONSTRAINT `leads_ibfk_3` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE SET NULL,
  CONSTRAINT `leads_ibfk_4` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `monthly_salaries`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `monthly_salaries` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `branch_id` int(11) NOT NULL,
  `salary_month` varchar(7) NOT NULL,
  `from_date` date NOT NULL,
  `to_date` date NOT NULL,
  `total_working_days` int(11) DEFAULT 0,
  `total_present_days` int(11) DEFAULT 0,
  `total_absent_days` int(11) DEFAULT 0,
  `total_half_days` int(11) DEFAULT 0,
  `total_sundays_worked` int(11) DEFAULT 0,
  `total_leaves` int(11) DEFAULT 0,
  `paid_sunday_leaves` int(11) DEFAULT 0,
  `paid_weekday_leaves` int(11) DEFAULT 0,
  `excess_leaves` int(11) DEFAULT 0,
  `total_standard_hours` decimal(10,2) DEFAULT 0.00,
  `total_sunday_hours` decimal(10,2) DEFAULT 0.00,
  `total_overtime_hours` decimal(10,2) DEFAULT 0.00,
  `approved_overtime_hours` decimal(8,2) DEFAULT NULL,
  `unapproved_overtime_hours` decimal(8,2) DEFAULT NULL,
  `total_worked_hours` decimal(10,2) DEFAULT 0.00,
  `base_salary` decimal(10,2) NOT NULL,
  `standard_hours_pay` decimal(10,2) DEFAULT 0.00,
  `sunday_hours_pay` decimal(10,2) DEFAULT 0.00,
  `overtime_pay` decimal(10,2) DEFAULT 0.00,
  `transport_allowance` decimal(10,2) DEFAULT 0.00,
  `food_allowance` decimal(10,2) DEFAULT 0.00,
  `other_allowance` decimal(10,2) DEFAULT 0.00,
  `total_allowances` decimal(10,2) DEFAULT 0.00,
  `incentive_amount` decimal(10,2) DEFAULT 0.00,
  `late_deduction` decimal(10,2) DEFAULT 0.00,
  `absence_deduction` decimal(10,2) DEFAULT 0.00,
  `leave_deduction` decimal(10,2) DEFAULT 0.00,
  `other_deduction` decimal(10,2) DEFAULT 0.00,
  `deduction_notes` text DEFAULT NULL,
  `total_deductions` decimal(10,2) DEFAULT 0.00,
  `gross_salary` decimal(10,2) GENERATED ALWAYS AS (`standard_hours_pay` + `sunday_hours_pay` + `overtime_pay` + `total_allowances` + `incentive_amount`) STORED,
  `net_salary` decimal(10,2) GENERATED ALWAYS AS (`standard_hours_pay` + `sunday_hours_pay` + `overtime_pay` + `total_allowances` + `incentive_amount` - `total_deductions`) STORED,
  `status` enum('draft','calculated','approved','paid') DEFAULT 'draft',
  `calculation_date` timestamp NULL DEFAULT NULL,
  `approved_by` int(11) DEFAULT NULL,
  `approved_at` timestamp NULL DEFAULT NULL,
  `payment_status` enum('unpaid','partial','paid') DEFAULT 'unpaid',
  `paid_amount` decimal(10,2) DEFAULT 0.00,
  `payment_date` date DEFAULT NULL,
  `payment_method` varchar(50) DEFAULT NULL,
  `payment_reference` varchar(100) DEFAULT NULL,
  `calculated_by` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `notes` text DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_user_month` (`user_id`,`salary_month`),
  KEY `approved_by` (`approved_by`),
  KEY `calculated_by` (`calculated_by`),
  KEY `idx_salary_month` (`salary_month`),
  KEY `idx_branch_month` (`branch_id`,`salary_month`),
  KEY `idx_status` (`status`),
  KEY `idx_payment_status` (`payment_status`),
  KEY `idx_payment_date` (`payment_date`),
  CONSTRAINT `monthly_salaries_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `monthly_salaries_ibfk_2` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`),
  CONSTRAINT `monthly_salaries_ibfk_3` FOREIGN KEY (`approved_by`) REFERENCES `users` (`id`),
  CONSTRAINT `monthly_salaries_ibfk_4` FOREIGN KEY (`calculated_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `notifications`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `notifications` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `type` varchar(50) NOT NULL,
  `title` varchar(255) NOT NULL,
  `body` text DEFAULT NULL,
  `data` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`data`)),
  `is_read` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_is_read` (`user_id`,`is_read`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_notif_user_read_created` (`user_id`,`is_read`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `otp_verifications`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `otp_verifications` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `phone` varchar(15) NOT NULL,
  `otp` varchar(64) DEFAULT NULL,
  `purpose` enum('registration','login','forgot_password','Staff Registration','Password Reset') NOT NULL,
  `verified` tinyint(1) DEFAULT 0,
  `expires_at` timestamp NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `attempts` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_phone` (`phone`),
  KEY `idx_otp` (`otp`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `outside_work_periods`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `outside_work_periods` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `attendance_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `reason` text NOT NULL,
  `start_time` datetime NOT NULL,
  `start_lat` decimal(10,8) DEFAULT NULL,
  `start_lng` decimal(11,8) DEFAULT NULL,
  `end_time` datetime DEFAULT NULL,
  `end_lat` decimal(10,8) DEFAULT NULL,
  `end_lng` decimal(11,8) DEFAULT NULL,
  `duration_minutes` int(11) DEFAULT NULL,
  `status` enum('active','ended') DEFAULT 'active',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `attendance_id` (`attendance_id`),
  KEY `idx_user_date` (`user_id`,`start_time`),
  KEY `idx_status` (`status`),
  KEY `idx_owp_user_status` (`user_id`,`status`),
  CONSTRAINT `outside_work_periods_ibfk_1` FOREIGN KEY (`attendance_id`) REFERENCES `staff_attendance` (`id`) ON DELETE CASCADE,
  CONSTRAINT `outside_work_periods_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `overtime_requests`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `overtime_requests` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `attendance_id` int(11) NOT NULL,
  `branch_id` int(11) NOT NULL,
  `request_date` date NOT NULL,
  `requested_at` datetime NOT NULL,
  `expected_minutes` int(11) NOT NULL,
  `working_minutes_at_request` int(11) NOT NULL,
  `status` enum('pending','approved','rejected','auto_clockout','expired') DEFAULT 'pending',
  `reviewed_by` int(11) DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  `review_notes` text DEFAULT NULL,
  `approved_minutes` int(11) DEFAULT 0,
  `reason` varchar(500) DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_user_date` (`user_id`,`request_date`),
  KEY `idx_status` (`status`),
  KEY `idx_attendance` (`attendance_id`),
  KEY `idx_ot_requests_branch` (`branch_id`),
  KEY `idx_otr_attendance_status` (`attendance_id`,`status`),
  KEY `idx_otr_branch_status` (`branch_id`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `pack_sizes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `pack_sizes` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `product_id` int(11) NOT NULL,
  `size` varchar(20) NOT NULL,
  `unit` varchar(20) DEFAULT 'L',
  `coverage` decimal(8,2) DEFAULT NULL,
  `base_price` decimal(10,2) NOT NULL,
  `zoho_item_id` varchar(100) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `color_name` varchar(100) DEFAULT NULL,
  `color_code` varchar(20) DEFAULT NULL,
  `size_label` varchar(50) GENERATED ALWAYS AS (cast(`size` as char charset utf8mb4)) VIRTUAL,
  PRIMARY KEY (`id`),
  KEY `idx_product_id` (`product_id`),
  KEY `idx_is_active` (`is_active`),
  KEY `idx_zoho_item` (`zoho_item_id`),
  CONSTRAINT `pack_sizes_ibfk_1` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_attendance`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_attendance` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `painter_id` int(11) NOT NULL,
  `event_type` enum('store_visit','training','event','demo') DEFAULT 'store_visit',
  `branch_id` int(11) DEFAULT NULL,
  `points_awarded` decimal(10,2) DEFAULT 0.00,
  `check_in_at` datetime NOT NULL,
  `check_out_at` datetime DEFAULT NULL,
  `check_in_photo_url` varchar(500) DEFAULT NULL,
  `latitude` decimal(10,8) DEFAULT NULL,
  `longitude` decimal(11,8) DEFAULT NULL,
  `distance_from_shop` int(11) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `verified_by` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `distance_meters` int(11) GENERATED ALWAYS AS (`distance_from_shop`) VIRTUAL,
  PRIMARY KEY (`id`),
  KEY `idx_painter_date` (`painter_id`,`check_in_at`),
  KEY `idx_pa_branch` (`branch_id`),
  CONSTRAINT `painter_attendance_ibfk_1` FOREIGN KEY (`painter_id`) REFERENCES `painters` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_attendance_checkins`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_attendance_checkins` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `painter_id` int(11) NOT NULL,
  `branch_id` int(11) NOT NULL,
  `checkin_date` date NOT NULL,
  `checkin_at` datetime NOT NULL,
  `latitude` decimal(10,8) NOT NULL,
  `longitude` decimal(11,8) NOT NULL,
  `distance_meters` int(11) NOT NULL,
  `selfie_path` varchar(500) NOT NULL,
  `status` enum('approved','rejected') NOT NULL DEFAULT 'approved',
  `rejected_at` datetime DEFAULT NULL,
  `rejected_reason` varchar(500) DEFAULT NULL,
  `rejected_by` int(11) DEFAULT NULL,
  `points_awarded` int(11) NOT NULL DEFAULT 100,
  `month_key` char(7) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_painter_day` (`painter_id`,`checkin_date`),
  KEY `idx_month` (`painter_id`,`month_key`),
  KEY `idx_branch_date` (`branch_id`,`checkin_date`),
  KEY `idx_status_date` (`status`,`checkin_date`),
  KEY `idx_pac_painter_date` (`painter_id`,`checkin_date`),
  CONSTRAINT `painter_attendance_checkins_ibfk_1` FOREIGN KEY (`painter_id`) REFERENCES `painters` (`id`) ON DELETE CASCADE,
  CONSTRAINT `painter_attendance_checkins_ibfk_2` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_attendance_ledger`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_attendance_ledger` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `painter_id` int(11) NOT NULL,
  `month_key` char(7) NOT NULL,
  `checkin_id` int(11) DEFAULT NULL,
  `type` enum('earn','claim','clawback','forfeit') NOT NULL,
  `ap_delta` int(11) NOT NULL,
  `reason` varchar(500) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `created_by` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_painter_month` (`painter_id`,`month_key`),
  KEY `idx_type_created` (`type`,`created_at`),
  KEY `checkin_id` (`checkin_id`),
  CONSTRAINT `painter_attendance_ledger_ibfk_1` FOREIGN KEY (`painter_id`) REFERENCES `painters` (`id`) ON DELETE CASCADE,
  CONSTRAINT `painter_attendance_ledger_ibfk_2` FOREIGN KEY (`checkin_id`) REFERENCES `painter_attendance_checkins` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_attendance_monthly`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_attendance_monthly` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `painter_id` int(11) NOT NULL,
  `month_key` char(7) NOT NULL,
  `total_checkins` int(11) NOT NULL DEFAULT 0,
  `total_ap_earned` int(11) NOT NULL DEFAULT 0,
  `monthly_customer_billed` decimal(12,2) NOT NULL DEFAULT 0.00,
  `claim_pct` decimal(5,2) NOT NULL DEFAULT 0.00,
  `claimable_ap` int(11) NOT NULL DEFAULT 0,
  `ap_claimed` int(11) NOT NULL DEFAULT 0,
  `claim_status` enum('pending','available','claimed','forfeited') NOT NULL DEFAULT 'pending',
  `claim_window_opens_at` datetime DEFAULT NULL,
  `claim_window_closes_at` datetime DEFAULT NULL,
  `claimed_at` datetime DEFAULT NULL,
  `forfeited_at` datetime DEFAULT NULL,
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_painter_month` (`painter_id`,`month_key`),
  KEY `idx_status_month` (`claim_status`,`month_key`),
  CONSTRAINT `painter_attendance_monthly_ibfk_1` FOREIGN KEY (`painter_id`) REFERENCES `painters` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_badges`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_badges` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `badge_key` varchar(50) NOT NULL,
  `name_en` varchar(100) NOT NULL,
  `name_ta` varchar(100) NOT NULL,
  `description_en` varchar(300) DEFAULT NULL,
  `description_ta` varchar(300) DEFAULT NULL,
  `icon` varchar(50) DEFAULT NULL,
  `unlock_condition` varchar(200) DEFAULT NULL,
  `category` varchar(50) DEFAULT 'general',
  `sort_order` int(11) DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `badge_key` (`badge_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_calculations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_calculations` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `painter_id` int(11) NOT NULL,
  `calculation_data` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`calculation_data`)),
  `total_sqft` decimal(10,2) DEFAULT NULL,
  `total_paint_liters` decimal(10,2) DEFAULT NULL,
  `estimated_cost` decimal(10,2) DEFAULT NULL,
  `converted_to` varchar(20) DEFAULT NULL,
  `converted_id` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_painter` (`painter_id`),
  CONSTRAINT `painter_calculations_ibfk_1` FOREIGN KEY (`painter_id`) REFERENCES `painters` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_catalog_brand_order`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_catalog_brand_order` (
  `brand` varchar(150) NOT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 999,
  `is_hidden` tinyint(1) NOT NULL DEFAULT 0,
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`brand`),
  KEY `idx_sort` (`sort_order`),
  KEY `idx_hidden` (`is_hidden`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_catalog_brand_overrides`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_catalog_brand_overrides` (
  `painter_id` int(11) NOT NULL,
  `brand` varchar(150) NOT NULL,
  `sort_order` int(11) DEFAULT NULL,
  `is_hidden` tinyint(1) DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`painter_id`,`brand`),
  KEY `idx_painter` (`painter_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_catalog_category_order`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_catalog_category_order` (
  `brand` varchar(150) NOT NULL,
  `category` varchar(150) NOT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 999,
  `is_hidden` tinyint(1) NOT NULL DEFAULT 0,
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`brand`,`category`),
  KEY `idx_brand_sort` (`brand`,`sort_order`),
  KEY `idx_hidden` (`is_hidden`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_catalog_category_overrides`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_catalog_category_overrides` (
  `painter_id` int(11) NOT NULL,
  `brand` varchar(150) NOT NULL,
  `category` varchar(150) NOT NULL,
  `sort_order` int(11) DEFAULT NULL,
  `is_hidden` tinyint(1) DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`painter_id`,`brand`,`category`),
  KEY `idx_painter` (`painter_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_catalog_product_order`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_catalog_product_order` (
  `product_id` int(11) NOT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 999,
  `is_hidden` tinyint(1) NOT NULL DEFAULT 0,
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`product_id`),
  KEY `idx_sort` (`sort_order`),
  KEY `idx_hidden` (`is_hidden`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_catalog_product_overrides`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_catalog_product_overrides` (
  `painter_id` int(11) NOT NULL,
  `product_id` int(11) NOT NULL,
  `sort_order` int(11) DEFAULT NULL,
  `is_hidden` tinyint(1) DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`painter_id`,`product_id`),
  KEY `idx_painter` (`painter_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_challenge_progress`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_challenge_progress` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `painter_id` int(11) NOT NULL,
  `challenge_id` int(11) NOT NULL,
  `current_count` int(11) DEFAULT 0,
  `completed` tinyint(1) DEFAULT 0,
  `claimed` tinyint(1) DEFAULT 0,
  `completed_at` timestamp NULL DEFAULT NULL,
  `claimed_at` timestamp NULL DEFAULT NULL,
  `current_value` decimal(12,2) DEFAULT 0.00,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_painter_challenge` (`painter_id`,`challenge_id`),
  KEY `challenge_id` (`challenge_id`),
  CONSTRAINT `painter_challenge_progress_ibfk_1` FOREIGN KEY (`painter_id`) REFERENCES `painters` (`id`),
  CONSTRAINT `painter_challenge_progress_ibfk_2` FOREIGN KEY (`challenge_id`) REFERENCES `painter_challenges` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_challenges`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_challenges` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `title_en` varchar(200) NOT NULL,
  `title_ta` varchar(200) NOT NULL,
  `description_en` text DEFAULT NULL,
  `description_ta` text DEFAULT NULL,
  `challenge_type` varchar(50) DEFAULT NULL,
  `target_count` int(11) NOT NULL,
  `reward_points` int(11) NOT NULL,
  `start_date` date NOT NULL,
  `end_date` date NOT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_clawback_pending`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_clawback_pending` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `painter_id` int(11) NOT NULL,
  `amount` int(11) NOT NULL,
  `reason` varchar(500) DEFAULT NULL,
  `source` varchar(50) NOT NULL DEFAULT 'attendance',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `settled_at` datetime DEFAULT NULL,
  `settled_ledger_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_painter_unsettled` (`painter_id`,`settled_at`),
  CONSTRAINT `painter_clawback_pending_ibfk_1` FOREIGN KEY (`painter_id`) REFERENCES `painters` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_custom_rates`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_custom_rates` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `painter_id` int(11) NOT NULL,
  `scope` enum('item','brand','category') NOT NULL,
  `target_id` varchar(150) NOT NULL,
  `zoho_item_id` varchar(50) DEFAULT NULL,
  `discount_pct` decimal(5,2) NOT NULL DEFAULT 0.00,
  `bonus_regular_points` decimal(10,2) NOT NULL DEFAULT 0.00,
  `notes` varchar(500) DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_painter_scope_target` (`painter_id`,`scope`,`target_id`),
  KEY `idx_painter` (`painter_id`),
  KEY `idx_scope_target` (`scope`,`target_id`),
  KEY `idx_zoho_item` (`zoho_item_id`),
  CONSTRAINT `painter_custom_rates_ibfk_1` FOREIGN KEY (`painter_id`) REFERENCES `painters` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_daily_assignments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_daily_assignments` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `branch_id` int(11) NOT NULL,
  `painter_lead_id` int(11) NOT NULL,
  `assigned_date` date NOT NULL,
  `contacted_at` timestamp NULL DEFAULT NULL,
  `contact_outcome` varchar(50) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_daily` (`user_id`,`painter_lead_id`,`assigned_date`),
  KEY `idx_staff_date` (`user_id`,`assigned_date`),
  KEY `idx_branch_date` (`branch_id`,`assigned_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_daily_checkins`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_daily_checkins` (
  `painter_id` int(11) NOT NULL,
  `checkin_date` date NOT NULL,
  `streak_count` int(11) NOT NULL DEFAULT 1,
  `bonus_awarded` decimal(10,2) DEFAULT 0.00,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`painter_id`,`checkin_date`),
  CONSTRAINT `painter_daily_checkins_ibfk_1` FOREIGN KEY (`painter_id`) REFERENCES `painters` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_earned_badges`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_earned_badges` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `painter_id` int(11) NOT NULL,
  `badge_id` int(11) NOT NULL,
  `earned_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_painter_badge` (`painter_id`,`badge_id`),
  KEY `badge_id` (`badge_id`),
  CONSTRAINT `painter_earned_badges_ibfk_1` FOREIGN KEY (`painter_id`) REFERENCES `painters` (`id`),
  CONSTRAINT `painter_earned_badges_ibfk_2` FOREIGN KEY (`badge_id`) REFERENCES `painter_badges` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_estimate_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_estimate_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `estimate_id` int(11) NOT NULL,
  `zoho_item_id` varchar(100) NOT NULL,
  `item_name` varchar(255) NOT NULL,
  `brand` varchar(100) DEFAULT NULL,
  `category` varchar(100) DEFAULT NULL,
  `quantity` decimal(10,2) NOT NULL DEFAULT 1.00,
  `unit_price` decimal(12,2) NOT NULL DEFAULT 0.00,
  `line_total` decimal(12,2) NOT NULL DEFAULT 0.00,
  `markup_unit_price` decimal(12,2) DEFAULT 0.00,
  `markup_line_total` decimal(12,2) DEFAULT 0.00,
  `display_order` int(11) DEFAULT 0,
  `deleted_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_estimate` (`estimate_id`),
  KEY `idx_pei_zoho_item` (`zoho_item_id`),
  KEY `idx_painter_estimate_items_deleted_at` (`deleted_at`),
  CONSTRAINT `painter_estimate_items_ibfk_1` FOREIGN KEY (`estimate_id`) REFERENCES `painter_estimates` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_estimate_sequence`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_estimate_sequence` (
  `date_prefix` varchar(12) NOT NULL,
  `last_seq` int(10) unsigned NOT NULL DEFAULT 0,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`date_prefix`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_estimates`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_estimates` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `estimate_number` varchar(20) NOT NULL,
  `painter_id` int(11) NOT NULL,
  `billing_type` enum('self','customer') NOT NULL,
  `customer_name` varchar(255) DEFAULT NULL,
  `customer_phone` varchar(20) DEFAULT NULL,
  `customer_address` text DEFAULT NULL,
  `subtotal` decimal(12,2) DEFAULT 0.00,
  `gst_amount` decimal(12,2) DEFAULT 0.00,
  `grand_total` decimal(12,2) DEFAULT 0.00,
  `markup_subtotal` decimal(12,2) DEFAULT 0.00,
  `markup_gst_amount` decimal(12,2) DEFAULT 0.00,
  `markup_grand_total` decimal(12,2) DEFAULT 0.00,
  `discount_percentage` decimal(5,2) DEFAULT NULL,
  `discount_amount` decimal(10,2) DEFAULT NULL,
  `final_grand_total` decimal(10,2) DEFAULT NULL,
  `discount_requested_at` timestamp NULL DEFAULT NULL,
  `discount_notes` text DEFAULT NULL,
  `discount_approved_by` int(11) DEFAULT NULL,
  `discount_approved_at` timestamp NULL DEFAULT NULL,
  `status` enum('draft','saved_direct','pending_admin','admin_review','approved','sent_to_customer','discount_requested','final_approved','payment_submitted','payment_recorded','pushed_to_zoho','rejected','cancelled') DEFAULT 'draft',
  `payment_method` varchar(50) DEFAULT NULL,
  `payment_reference` varchar(255) DEFAULT NULL,
  `payment_amount` decimal(12,2) DEFAULT 0.00,
  `payment_recorded_by` int(11) DEFAULT NULL,
  `payment_recorded_at` datetime DEFAULT NULL,
  `zoho_invoice_id` varchar(100) DEFAULT NULL,
  `zoho_invoice_number` varchar(100) DEFAULT NULL,
  `zoho_contact_id` varchar(100) DEFAULT NULL,
  `points_awarded` decimal(12,2) DEFAULT 0.00,
  `regular_points_awarded` decimal(12,2) DEFAULT 0.00,
  `annual_points_awarded` decimal(12,2) DEFAULT 0.00,
  `share_token` varchar(64) DEFAULT NULL,
  `share_token_expires_at` datetime DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `admin_notes` text DEFAULT NULL,
  `created_by_painter` int(11) NOT NULL,
  `reviewed_by` int(11) DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `hide_qc_branding` tinyint(1) NOT NULL DEFAULT 0 COMMENT 'Customer PDF strips QC logo/name/UPI/footer when 1',
  `labour_charge` decimal(12,2) NOT NULL DEFAULT 0.00 COMMENT 'Flat labour line added to total on customer estimates',
  `pricing_mode` enum('direct','request_qc_price') NOT NULL DEFAULT 'direct' COMMENT 'direct = painter sets own markup; request_qc_price = QC admin sets final',
  `total` decimal(12,2) GENERATED ALWAYS AS (`grand_total`) VIRTUAL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `estimate_number` (`estimate_number`),
  KEY `idx_painter` (`painter_id`),
  KEY `idx_status` (`status`),
  KEY `idx_billing_type` (`billing_type`),
  KEY `idx_estimate_number` (`estimate_number`),
  KEY `idx_share_token` (`share_token`),
  KEY `idx_pe_zoho_invoice` (`zoho_invoice_id`),
  KEY `idx_pe_zoho_contact` (`zoho_contact_id`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_pe_painter_status_created` (`painter_id`,`status`,`created_at` DESC),
  KEY `idx_pe_status_created` (`status`,`created_at` DESC),
  CONSTRAINT `painter_estimates_ibfk_1` FOREIGN KEY (`painter_id`) REFERENCES `painters` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_fcm_tokens`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_fcm_tokens` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `painter_id` int(11) NOT NULL,
  `fcm_token` varchar(500) NOT NULL,
  `device_info` varchar(255) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_token` (`fcm_token`),
  KEY `idx_painter` (`painter_id`),
  CONSTRAINT `painter_fcm_tokens_ibfk_1` FOREIGN KEY (`painter_id`) REFERENCES `painters` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_gallery`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_gallery` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `painter_id` int(11) NOT NULL,
  `photo_url` varchar(500) NOT NULL,
  `category` enum('interior','exterior','texture','waterproofing','other') DEFAULT 'interior',
  `description` varchar(500) DEFAULT NULL,
  `is_before` tinyint(1) DEFAULT 0,
  `pair_id` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_painter` (`painter_id`),
  CONSTRAINT `painter_gallery_ibfk_1` FOREIGN KEY (`painter_id`) REFERENCES `painters` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_invoices_processed`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_invoices_processed` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `painter_id` int(11) NOT NULL,
  `invoice_id` varchar(100) NOT NULL,
  `invoice_number` varchar(100) DEFAULT NULL,
  `invoice_date` date DEFAULT NULL,
  `invoice_total` decimal(12,2) DEFAULT NULL,
  `billing_type` enum('self','customer') NOT NULL,
  `regular_points` decimal(12,2) DEFAULT 0.00,
  `annual_points` decimal(12,2) DEFAULT 0.00,
  `referral_points` decimal(12,2) DEFAULT 0.00,
  `processed_at` timestamp NULL DEFAULT current_timestamp(),
  `attribution_type` enum('direct_billing','salesperson','painter_estimate') DEFAULT 'painter_estimate',
  `source_invoice_date` date DEFAULT NULL,
  `zoho_invoice_id` varchar(50) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_painter_invoice_type` (`painter_id`,`invoice_id`,`attribution_type`),
  KEY `idx_painter` (`painter_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_lead_duplicate_queue`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_lead_duplicate_queue` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `original_painter_lead_id` int(11) DEFAULT NULL,
  `duplicate_zoho_customer_id` varchar(50) NOT NULL,
  `duplicate_zoho_name` varchar(255) NOT NULL,
  `duplicate_phone` varchar(20) NOT NULL,
  `resolution` enum('pending','merged','kept_original','kept_duplicate','ignored') DEFAULT 'pending',
  `resolved_by` int(11) DEFAULT NULL,
  `resolved_at` timestamp NULL DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_resolution` (`resolution`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_lead_followups`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_lead_followups` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `painter_lead_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `followup_type` enum('call','whatsapp','visit') NOT NULL,
  `call_status` enum('connected','not_answered','wrong_number','switched_off','busy') DEFAULT NULL,
  `outcome` enum('interested_in_program','already_aware','will_visit_shop','wants_callback','not_interested','wrong_number','no_answer') DEFAULT NULL,
  `next_followup_date` date DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_lead` (`painter_lead_id`),
  KEY `idx_user_date` (`user_id`,`created_at`),
  CONSTRAINT `painter_lead_followups_ibfk_1` FOREIGN KEY (`painter_lead_id`) REFERENCES `painter_leads` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_leads`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_leads` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `zoho_customer_id` varchar(50) DEFAULT NULL,
  `painter_id` int(11) DEFAULT NULL,
  `full_name` varchar(255) NOT NULL,
  `phone` varchar(20) NOT NULL,
  `email` varchar(255) DEFAULT NULL,
  `branch_id` int(11) DEFAULT NULL,
  `branch_detected_via` enum('zoho_branch_id','name_prefix','invoice_history','admin_assign') DEFAULT NULL,
  `assigned_to` int(11) DEFAULT NULL,
  `status` enum('new','in_progress','interested','converted','active_painter','not_interested','unreachable','wrong_number','duplicate','snoozed') DEFAULT 'new',
  `last_contact_date` timestamp NULL DEFAULT NULL,
  `last_outcome` varchar(50) DEFAULT NULL,
  `next_eligible_date` date DEFAULT NULL,
  `total_attempts` int(11) DEFAULT 0,
  `contact_count` int(11) DEFAULT 0,
  `notes` text DEFAULT NULL,
  `source_lead_id` int(11) DEFAULT NULL,
  `created_via` varchar(50) DEFAULT NULL,
  `source_lead_name` varchar(200) DEFAULT NULL,
  `imported_at` timestamp NULL DEFAULT current_timestamp(),
  `converted_at` timestamp NULL DEFAULT NULL,
  `activated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `phone` (`phone`),
  KEY `idx_branch_assigned` (`branch_id`,`assigned_to`),
  KEY `idx_next_eligible` (`next_eligible_date`,`status`),
  KEY `idx_painter` (`painter_id`),
  KEY `idx_zoho` (`zoho_customer_id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_levels`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_levels` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `level_name` varchar(20) NOT NULL,
  `min_points` int(11) NOT NULL,
  `multiplier` decimal(3,2) NOT NULL DEFAULT 1.00,
  `badge_color` varchar(7) NOT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `level_name` (`level_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_location_events`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_location_events` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `painter_id` int(11) NOT NULL,
  `latitude` decimal(10,7) NOT NULL,
  `longitude` decimal(10,7) NOT NULL,
  `accuracy_m` float DEFAULT NULL,
  `recorded_at` datetime NOT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_painter_time` (`painter_id`,`recorded_at`),
  CONSTRAINT `painter_location_events_ibfk_1` FOREIGN KEY (`painter_id`) REFERENCES `painters` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_marketing_config`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_marketing_config` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `scope` enum('branch','user') NOT NULL,
  `scope_id` int(11) NOT NULL,
  `daily_quota` int(11) NOT NULL DEFAULT 10,
  `recycle_days_new` int(11) DEFAULT 7,
  `recycle_days_callback` int(11) DEFAULT 3,
  `recycle_days_will_visit` int(11) DEFAULT 14,
  `recycle_days_already_aware` int(11) DEFAULT 60,
  `recycle_days_not_interested` int(11) DEFAULT 30,
  `recycle_days_unreachable` int(11) DEFAULT 60,
  `recycle_days_active_painter` int(11) DEFAULT 45,
  `is_active` tinyint(4) DEFAULT 1,
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_scope` (`scope`,`scope_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_notifications`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_notifications` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `painter_id` int(11) NOT NULL,
  `type` varchar(50) NOT NULL,
  `title` varchar(255) NOT NULL,
  `title_ta` varchar(255) DEFAULT NULL,
  `body` text DEFAULT NULL,
  `body_ta` text DEFAULT NULL,
  `data` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`data`)),
  `is_read` tinyint(1) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_painter_read` (`painter_id`,`is_read`),
  KEY `idx_created` (`created_at`),
  CONSTRAINT `painter_notifications_ibfk_1` FOREIGN KEY (`painter_id`) REFERENCES `painters` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_pntr_import_runs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_pntr_import_runs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `run_type` enum('initial_bulk','incremental_daily','manual') NOT NULL,
  `started_at` timestamp NULL DEFAULT current_timestamp(),
  `completed_at` timestamp NULL DEFAULT NULL,
  `total_zoho_pntr_customers` int(11) DEFAULT 0,
  `imported_count` int(11) DEFAULT 0,
  `linked_existing_painter` int(11) DEFAULT 0,
  `duplicates_queued` int(11) DEFAULT 0,
  `branch_unresolved_count` int(11) DEFAULT 0,
  `errors_count` int(11) DEFAULT 0,
  `triggered_by` int(11) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `status` enum('running','completed','failed') DEFAULT 'running',
  PRIMARY KEY (`id`),
  KEY `idx_started` (`started_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_point_transactions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_point_transactions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `painter_id` int(11) NOT NULL,
  `pool` enum('regular','annual') NOT NULL,
  `type` enum('earn','redeem','debit','adjustment','expired') NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `balance_after` decimal(12,2) NOT NULL,
  `source` enum('self_billing','customer_billing','referral','attendance','monthly_slab','quarterly_slab','withdrawal','credit_debit','admin_adjustment','streak_bonus','daily_bonus','clawback','challenge_reward','attendance_claim','attendance_clawback','invoice_backfill') NOT NULL,
  `reference_id` varchar(100) DEFAULT NULL,
  `reference_type` varchar(50) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `points` int(11) GENERATED ALWAYS AS (`amount`) VIRTUAL,
  PRIMARY KEY (`id`),
  KEY `idx_painter_pool` (`painter_id`,`pool`),
  KEY `idx_source` (`source`),
  KEY `idx_created` (`created_at`),
  KEY `idx_ppt_reference` (`reference_id`),
  KEY `idx_ppt_painter_created` (`painter_id`,`created_at` DESC),
  CONSTRAINT `painter_point_transactions_ibfk_1` FOREIGN KEY (`painter_id`) REFERENCES `painters` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_price_reports`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_price_reports` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `painter_id` int(11) NOT NULL,
  `zoho_item_id` varchar(50) DEFAULT NULL,
  `product_name` varchar(300) DEFAULT NULL,
  `our_price` decimal(10,2) DEFAULT NULL,
  `reported_price` decimal(10,2) DEFAULT NULL,
  `shop_name` varchar(200) DEFAULT NULL,
  `shop_location` varchar(300) DEFAULT NULL,
  `proof_photo_url` varchar(500) DEFAULT NULL,
  `note` text DEFAULT NULL,
  `status` enum('pending','approved','rejected') DEFAULT 'pending',
  `admin_response` text DEFAULT NULL,
  `matched_price` decimal(10,2) DEFAULT NULL,
  `reviewed_by` int(11) DEFAULT NULL,
  `reviewed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_painter` (`painter_id`),
  KEY `idx_status` (`status`),
  CONSTRAINT `painter_price_reports_ibfk_1` FOREIGN KEY (`painter_id`) REFERENCES `painters` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_product_point_rates`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_product_point_rates` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `item_id` varchar(100) NOT NULL,
  `item_name` varchar(255) DEFAULT NULL,
  `regular_points_per_unit` decimal(10,2) DEFAULT 0.00,
  `annual_eligible` tinyint(1) DEFAULT 0,
  `annual_pct` decimal(5,2) DEFAULT 1.00,
  `category` varchar(100) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_item` (`item_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_product_requests`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_product_requests` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `painter_id` int(11) NOT NULL,
  `product_name` varchar(300) NOT NULL,
  `brand` varchar(100) DEFAULT NULL,
  `size_needed` varchar(100) DEFAULT NULL,
  `note` text DEFAULT NULL,
  `status` enum('pending','added','rejected') DEFAULT 'pending',
  `added_product_id` int(11) DEFAULT NULL,
  `reviewed_by` int(11) DEFAULT NULL,
  `reviewed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_painter` (`painter_id`),
  KEY `idx_status` (`status`),
  CONSTRAINT `painter_product_requests_ibfk_1` FOREIGN KEY (`painter_id`) REFERENCES `painters` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_quotation_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_quotation_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `quotation_id` int(11) NOT NULL,
  `zoho_item_id` varchar(50) DEFAULT NULL,
  `item_name` varchar(300) DEFAULT NULL,
  `brand` varchar(100) DEFAULT NULL,
  `quantity` decimal(10,2) DEFAULT NULL,
  `unit_price` decimal(10,2) DEFAULT NULL,
  `line_total` decimal(10,2) DEFAULT NULL,
  `display_order` int(11) DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `quotation_id` (`quotation_id`),
  CONSTRAINT `painter_quotation_items_ibfk_1` FOREIGN KEY (`quotation_id`) REFERENCES `painter_quotations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_quotations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_quotations` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `painter_id` int(11) NOT NULL,
  `quotation_number` varchar(20) NOT NULL,
  `quotation_type` enum('labour_salary','labour_sqft','labour_material_sqft','labour_material_itemized') NOT NULL,
  `customer_name` varchar(200) DEFAULT NULL,
  `customer_phone` varchar(20) DEFAULT NULL,
  `customer_address` text DEFAULT NULL,
  `rooms_data` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`rooms_data`)),
  `labour_rate` decimal(10,2) DEFAULT NULL,
  `labour_rate_type` enum('daily','monthly','per_sqft','day','sqft') DEFAULT 'daily',
  `material_cost_per_sqft` decimal(10,2) DEFAULT NULL,
  `total_sqft` decimal(10,2) DEFAULT NULL,
  `labour_total` decimal(10,2) DEFAULT NULL,
  `material_total` decimal(10,2) DEFAULT NULL,
  `grand_total` decimal(10,2) DEFAULT NULL,
  `terms_conditions` text DEFAULT NULL,
  `validity_days` int(11) DEFAULT 15,
  `language` enum('ta','en') DEFAULT 'ta',
  `status` enum('draft','sent','accepted','rejected','expired') DEFAULT 'draft',
  `pdf_url` varchar(500) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_painter_status` (`painter_id`,`status`),
  CONSTRAINT `painter_quotations_ibfk_1` FOREIGN KEY (`painter_id`) REFERENCES `painters` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_referrals`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_referrals` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `referrer_id` int(11) NOT NULL,
  `referred_id` int(11) NOT NULL,
  `status` enum('pending','approved','active') DEFAULT 'pending',
  `total_bills` int(11) DEFAULT 0,
  `current_tier_pct` decimal(5,2) DEFAULT 0.50,
  `total_referral_points` decimal(12,2) DEFAULT 0.00,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_pair` (`referrer_id`,`referred_id`),
  KEY `referred_id` (`referred_id`),
  CONSTRAINT `painter_referrals_ibfk_1` FOREIGN KEY (`referrer_id`) REFERENCES `painters` (`id`),
  CONSTRAINT `painter_referrals_ibfk_2` FOREIGN KEY (`referred_id`) REFERENCES `painters` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_sessions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_sessions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `painter_id` int(11) NOT NULL,
  `token` varchar(255) NOT NULL,
  `otp` varchar(64) DEFAULT NULL,
  `otp_expires_at` datetime DEFAULT NULL,
  `expires_at` datetime NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `token_hash` char(64) DEFAULT NULL,
  `otp_attempts` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `token` (`token`),
  KEY `painter_id` (`painter_id`),
  KEY `idx_token` (`token`),
  KEY `idx_token_hash` (`token_hash`),
  CONSTRAINT `painter_sessions_ibfk_1` FOREIGN KEY (`painter_id`) REFERENCES `painters` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_slab_evaluations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_slab_evaluations` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `painter_id` int(11) NOT NULL,
  `period_type` enum('monthly','quarterly') NOT NULL,
  `period_label` varchar(20) NOT NULL,
  `period_start` date NOT NULL,
  `period_end` date NOT NULL,
  `total_purchase` decimal(12,2) DEFAULT 0.00,
  `slab_id` int(11) DEFAULT NULL,
  `points_awarded` decimal(12,2) DEFAULT 0.00,
  `evaluated_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_eval` (`painter_id`,`period_type`,`period_label`),
  KEY `idx_period` (`period_type`,`period_label`),
  KEY `idx_pse_slab` (`slab_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_special_offers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_special_offers` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `title` varchar(255) NOT NULL,
  `title_ta` varchar(255) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `description_ta` text DEFAULT NULL,
  `offer_type` enum('multiplier','bonus_points','bonus_pct','free_product','discount') DEFAULT 'multiplier',
  `multiplier_value` decimal(4,2) DEFAULT 1.00,
  `bonus_points` decimal(12,2) DEFAULT 0.00,
  `applies_to` enum('all','brand','category','product') DEFAULT 'all',
  `target_id` varchar(100) DEFAULT NULL,
  `start_date` date NOT NULL,
  `end_date` date NOT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  `banner_image_url` varchar(500) DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_active_dates` (`is_active`,`start_date`,`end_date`),
  KEY `idx_applies_to` (`applies_to`,`target_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_training_categories`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_training_categories` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `name_ta` varchar(100) DEFAULT NULL,
  `icon` varchar(10) DEFAULT '?',
  `sort_order` int(11) DEFAULT 0,
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_training_content`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_training_content` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `category_id` int(11) DEFAULT NULL,
  `title` varchar(255) NOT NULL,
  `title_ta` varchar(255) DEFAULT NULL,
  `content_type` enum('article','video','pdf') DEFAULT 'article',
  `content_en` longtext DEFAULT NULL,
  `content_ta` longtext DEFAULT NULL,
  `summary` varchar(500) DEFAULT NULL,
  `summary_ta` varchar(500) DEFAULT NULL,
  `youtube_url` varchar(500) DEFAULT NULL,
  `pdf_url` varchar(500) DEFAULT NULL,
  `thumbnail_url` varchar(500) DEFAULT NULL,
  `language` enum('en','ta','both') DEFAULT 'both',
  `is_featured` tinyint(1) DEFAULT 0,
  `status` enum('draft','published','archived') DEFAULT 'draft',
  `sort_order` int(11) DEFAULT 0,
  `view_count` int(11) DEFAULT 0,
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_category` (`category_id`),
  KEY `idx_status` (`status`),
  KEY `idx_featured` (`is_featured`,`status`),
  CONSTRAINT `painter_training_content_ibfk_1` FOREIGN KEY (`category_id`) REFERENCES `painter_training_categories` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_value_slabs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_value_slabs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `period_type` enum('monthly','quarterly') NOT NULL,
  `min_amount` decimal(12,2) NOT NULL,
  `max_amount` decimal(12,2) DEFAULT NULL,
  `bonus_points` decimal(12,2) NOT NULL,
  `label` varchar(100) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  PRIMARY KEY (`id`),
  KEY `idx_period` (`period_type`,`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_visualization_requests`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_visualization_requests` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `painter_id` int(11) NOT NULL,
  `photo_path` varchar(500) NOT NULL,
  `brand` varchar(100) DEFAULT NULL,
  `color_name` varchar(100) DEFAULT NULL,
  `color_code` varchar(50) DEFAULT NULL,
  `color_hex` varchar(7) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `status` enum('pending','in_progress','completed','rejected') DEFAULT 'pending',
  `visualization_path` varchar(500) DEFAULT NULL,
  `admin_notes` text DEFAULT NULL,
  `processed_by` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `completed_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_painter` (`painter_id`),
  KEY `idx_status` (`status`),
  CONSTRAINT `painter_visualization_requests_ibfk_1` FOREIGN KEY (`painter_id`) REFERENCES `painters` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_withdrawals`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_withdrawals` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `painter_id` int(11) NOT NULL,
  `pool` enum('regular','annual') NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `status` enum('pending','approved','rejected','paid') DEFAULT 'pending',
  `payment_method` varchar(50) DEFAULT NULL,
  `payment_reference` varchar(255) DEFAULT NULL,
  `requested_at` timestamp NULL DEFAULT current_timestamp(),
  `processed_by` int(11) DEFAULT NULL,
  `processed_at` datetime DEFAULT NULL,
  `notes` text DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_painter` (`painter_id`),
  KEY `idx_status` (`status`),
  CONSTRAINT `painter_withdrawals_ibfk_1` FOREIGN KEY (`painter_id`) REFERENCES `painters` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_zoho_salesperson_map`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_zoho_salesperson_map` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `zoho_salesperson_id` varchar(50) NOT NULL,
  `zoho_salesperson_name` varchar(255) NOT NULL,
  `zoho_salesperson_phone` varchar(20) DEFAULT NULL,
  `painter_id` int(11) DEFAULT NULL,
  `match_confidence` enum('exact_phone','exact_name','fuzzy_name','unmatched') DEFAULT 'unmatched',
  `last_synced_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `zoho_salesperson_id` (`zoho_salesperson_id`),
  KEY `idx_painter` (`painter_id`),
  KEY `idx_phone` (`zoho_salesperson_phone`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painter_zoho_sync_queue`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painter_zoho_sync_queue` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `painter_id` int(11) NOT NULL,
  `sync_type` enum('customer','salesperson','both') NOT NULL,
  `status` enum('pending','processing','completed','failed') DEFAULT 'pending',
  `attempts` int(11) DEFAULT 0,
  `last_error` text DEFAULT NULL,
  `next_retry_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `completed_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_status_retry` (`status`,`next_retry_at`),
  KEY `idx_painter` (`painter_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `painters`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `painters` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `full_name` varchar(255) NOT NULL,
  `phone` varchar(20) NOT NULL,
  `email` varchar(255) DEFAULT NULL,
  `aadhar_number` varchar(20) DEFAULT NULL,
  `pan_number` varchar(20) DEFAULT NULL,
  `address` text DEFAULT NULL,
  `city` varchar(100) DEFAULT NULL,
  `district` varchar(100) DEFAULT NULL,
  `state` varchar(100) DEFAULT 'Tamil Nadu',
  `pincode` varchar(10) DEFAULT NULL,
  `experience_years` int(11) DEFAULT 0,
  `specialization` enum('interior','exterior','both','industrial') DEFAULT 'both',
  `profile_photo` varchar(500) DEFAULT NULL,
  `referred_by` int(11) DEFAULT NULL,
  `branch_id` int(11) DEFAULT NULL,
  `referral_code` varchar(20) DEFAULT NULL,
  `status` enum('pending','approved','suspended','rejected') DEFAULT 'pending',
  `approved_by` int(11) DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `credit_enabled` tinyint(1) DEFAULT 0,
  `credit_limit` decimal(12,2) DEFAULT 0.00,
  `credit_used` decimal(12,2) DEFAULT 0.00,
  `credit_overdue_days` int(11) DEFAULT 0,
  `regular_points` decimal(12,2) DEFAULT 0.00,
  `annual_points` decimal(12,2) DEFAULT 0.00,
  `total_earned_regular` decimal(12,2) DEFAULT 0.00,
  `total_earned_annual` decimal(12,2) DEFAULT 0.00,
  `total_redeemed_regular` decimal(12,2) DEFAULT 0.00,
  `total_redeemed_annual` decimal(12,2) DEFAULT 0.00,
  `zoho_contact_id` varchar(50) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `profile_completeness` decimal(3,2) DEFAULT 0.00,
  `card_generated_at` timestamp NULL DEFAULT NULL,
  `id_card_generated_at` timestamp NULL DEFAULT NULL,
  `current_level` varchar(20) DEFAULT 'bronze',
  `current_streak` int(11) DEFAULT 0,
  `last_checkin_date` date DEFAULT NULL,
  `longest_streak` int(11) DEFAULT 0,
  `last_briefing_at` timestamp NULL DEFAULT NULL,
  `level` varchar(20) DEFAULT 'bronze',
  `total_lifetime_points` int(11) DEFAULT 0,
  `zoho_customer_id` varchar(50) DEFAULT NULL,
  `zoho_salesperson_id` varchar(50) DEFAULT NULL,
  `created_via` enum('zoho_import','staff_convert','admin_add','self_register','referral') DEFAULT 'self_register',
  `activated_at` timestamp NULL DEFAULT NULL,
  `source_lead_id` int(11) DEFAULT NULL,
  `approval_request_count` int(11) NOT NULL DEFAULT 0,
  `last_approval_request_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `phone` (`phone`),
  UNIQUE KEY `referral_code` (`referral_code`),
  KEY `idx_phone` (`phone`),
  KEY `idx_status` (`status`),
  KEY `idx_referral_code` (`referral_code`),
  KEY `idx_referred_by` (`referred_by`),
  KEY `idx_painters_zoho_contact` (`zoho_contact_id`),
  KEY `idx_zoho_customer` (`zoho_customer_id`),
  KEY `idx_zoho_salesperson` (`zoho_salesperson_id`),
  KEY `idx_activated` (`activated_at`),
  KEY `idx_painters_branch` (`branch_id`),
  CONSTRAINT `fk_painters_branch` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `password_reset_tokens`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `password_reset_tokens` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `token_hash` char(64) NOT NULL,
  `expires_at` datetime NOT NULL,
  `used_at` datetime DEFAULT NULL,
  `requested_ip` varchar(45) DEFAULT NULL,
  `requested_ua` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `token_hash` (`token_hash`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_expires_at` (`expires_at`),
  CONSTRAINT `password_reset_tokens_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `payment_links`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `payment_links` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `invoice_id` varchar(100) NOT NULL,
  `zoho_invoice_number` varchar(100) DEFAULT NULL,
  `customer_name` varchar(200) DEFAULT NULL,
  `customer_phone` varchar(20) DEFAULT NULL,
  `amount` decimal(12,2) NOT NULL,
  `currency` varchar(10) DEFAULT 'INR',
  `zoho_payment_link_id` varchar(255) DEFAULT NULL,
  `zoho_payment_id` varchar(255) DEFAULT NULL,
  `status` enum('created','paid','failed','expired') DEFAULT 'created',
  `expires_at` datetime DEFAULT NULL,
  `paid_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `zoho_payment_link_url` varchar(1024) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_invoice` (`invoice_id`),
  KEY `idx_status` (`status`),
  KEY `idx_zoho_link` (`zoho_payment_link_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `payment_promises`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `payment_promises` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `zoho_invoice_id` varchar(50) DEFAULT NULL,
  `zoho_customer_id` varchar(50) NOT NULL,
  `customer_name` varchar(255) DEFAULT NULL,
  `customer_phone` varchar(20) DEFAULT NULL,
  `promise_date` date NOT NULL,
  `promise_amount` decimal(12,2) NOT NULL,
  `status` enum('pending','kept','broken','partial') DEFAULT 'pending',
  `actual_payment_date` date DEFAULT NULL,
  `actual_amount` decimal(12,2) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `follow_up_date` date DEFAULT NULL,
  `wa_reminder_sent_at` datetime DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `follow_up_staff_id` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `branch_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_pp_customer` (`zoho_customer_id`),
  KEY `idx_pp_status` (`status`),
  KEY `created_by` (`created_by`),
  KEY `idx_pp_branch` (`branch_id`),
  KEY `idx_pp_zoho_invoice` (`zoho_invoice_id`),
  KEY `idx_pp_promise_date` (`promise_date`),
  CONSTRAINT `payment_promises_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `permissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `permissions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `module` varchar(100) NOT NULL,
  `action` varchar(50) NOT NULL,
  `display_name` varchar(100) NOT NULL,
  `description` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_permission` (`module`,`action`),
  KEY `idx_module` (`module`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `prayer_periods`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `prayer_periods` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `attendance_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `start_time` datetime NOT NULL,
  `start_lat` decimal(10,8) DEFAULT NULL,
  `start_lng` decimal(11,8) DEFAULT NULL,
  `end_time` datetime DEFAULT NULL,
  `end_lat` decimal(10,8) DEFAULT NULL,
  `end_lng` decimal(11,8) DEFAULT NULL,
  `duration_minutes` int(11) DEFAULT NULL,
  `status` enum('active','ended') DEFAULT 'active',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `attendance_id` (`attendance_id`),
  KEY `idx_user_date` (`user_id`,`start_time`),
  KEY `idx_status` (`status`),
  KEY `idx_pp_user_status` (`user_id`,`status`),
  CONSTRAINT `prayer_periods_ibfk_1` FOREIGN KEY (`attendance_id`) REFERENCES `staff_attendance` (`id`) ON DELETE CASCADE,
  CONSTRAINT `prayer_periods_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `production_health_snapshots`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `production_health_snapshots` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `memory_heap_mb` int(11) DEFAULT 0,
  `memory_heap_pct` int(11) DEFAULT 0,
  `memory_rss_mb` int(11) DEFAULT 0,
  `event_loop_lag_ms` int(11) DEFAULT 0,
  `db_pool_used_pct` int(11) DEFAULT 0,
  `db_ping_ms` int(11) DEFAULT 0,
  `db_queue_length` int(11) DEFAULT 0,
  `api_p50_ms` int(11) DEFAULT 0,
  `api_p95_ms` int(11) DEFAULT 0,
  `api_p99_ms` int(11) DEFAULT 0,
  `api_rpm` int(11) DEFAULT 0,
  `socket_connections` int(11) DEFAULT 0,
  `uptime_seconds` int(11) DEFAULT 0,
  `healing_actions_1h` int(11) DEFAULT 0,
  `circuit_breaker_state` varchar(20) DEFAULT 'closed',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_heap_pct` (`memory_heap_pct`),
  KEY `idx_lag` (`event_loop_lag_ms`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `products`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `products` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `brand_id` int(11) DEFAULT NULL,
  `category_id` int(11) DEFAULT NULL,
  `name` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `product_type` enum('area_wise','unit_wise') NOT NULL,
  `area_coverage` decimal(10,2) DEFAULT NULL COMMENT 'sqft per liter',
  `available_sizes` longtext DEFAULT NULL COMMENT '[1,4,10,20]' CHECK (json_valid(`available_sizes`)),
  `base_price` decimal(10,2) NOT NULL COMMENT 'Price INCLUDING GST',
  `gst_percentage` decimal(5,2) DEFAULT 18.00,
  `is_gst_inclusive` tinyint(1) DEFAULT 1,
  `status` enum('active','inactive') DEFAULT 'active',
  `visible_to_guest` tinyint(1) DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `is_public` tinyint(1) DEFAULT 0,
  `show_to_staff` tinyint(1) DEFAULT 1,
  `show_to_customers` tinyint(1) DEFAULT 1,
  `image_url` varchar(500) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `brand_id` (`brand_id`),
  KEY `category_id` (`category_id`),
  KEY `idx_status` (`status`),
  KEY `idx_type` (`product_type`),
  CONSTRAINT `products_ibfk_1` FOREIGN KEY (`brand_id`) REFERENCES `brands` (`id`),
  CONSTRAINT `products_ibfk_2` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `push_subscriptions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `push_subscriptions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `type` enum('web','fcm') NOT NULL,
  `endpoint` varchar(512) DEFAULT NULL,
  `p256dh` varchar(255) DEFAULT NULL,
  `auth_key` varchar(255) DEFAULT NULL,
  `fcm_token` varchar(512) DEFAULT NULL,
  `device_info` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_endpoint` (`endpoint`(191)),
  UNIQUE KEY `uk_fcm_token` (`fcm_token`(191)),
  KEY `idx_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `reorder_report_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `reorder_report_log` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `report_date` date NOT NULL,
  `scope` varchar(50) NOT NULL,
  `items_count` int(11) NOT NULL,
  `delivery_status` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`delivery_status`)),
  `generated_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_date_scope` (`report_date`,`scope`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `reorder_snoozes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `reorder_snoozes` (
  `zoho_item_id` varchar(50) NOT NULL,
  `zoho_location_id` varchar(50) NOT NULL,
  `snoozed_until` datetime DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `snoozed_by` int(11) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`zoho_item_id`,`zoho_location_id`),
  KEY `idx_until` (`snoozed_until`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `role_permissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `role_permissions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `role_id` int(11) NOT NULL,
  `permission_id` int(11) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_role_permission` (`role_id`,`permission_id`),
  KEY `idx_role` (`role_id`),
  KEY `idx_permission` (`permission_id`),
  CONSTRAINT `role_permissions_ibfk_1` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE,
  CONSTRAINT `role_permissions_ibfk_2` FOREIGN KEY (`permission_id`) REFERENCES `permissions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `roles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `roles` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `display_name` varchar(100) NOT NULL,
  `description` text DEFAULT NULL,
  `user_type` enum('staff','customer') NOT NULL,
  `is_system_role` tinyint(1) DEFAULT 0,
  `status` enum('active','inactive') DEFAULT 'active',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `price_markup_percent` decimal(5,2) DEFAULT 0.00 COMMENT 'Price markup percentage for customers (e.g., 10.50 for 10.5%)',
  `default_discount_percent` decimal(5,2) DEFAULT 0.00 COMMENT 'Default discount percentage for customers (e.g., 15.00 for 15%)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`),
  KEY `idx_user_type` (`user_type`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `salary_adjustments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `salary_adjustments` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `monthly_salary_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `adjustment_type` enum('bonus','penalty','advance','loan_recovery','other') NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `description` text NOT NULL,
  `is_applied` tinyint(1) DEFAULT 1,
  `created_by` int(11) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `created_by` (`created_by`),
  KEY `idx_monthly_salary` (`monthly_salary_id`),
  KEY `idx_user` (`user_id`),
  KEY `idx_type` (`adjustment_type`),
  CONSTRAINT `salary_adjustments_ibfk_1` FOREIGN KEY (`monthly_salary_id`) REFERENCES `monthly_salaries` (`id`) ON DELETE CASCADE,
  CONSTRAINT `salary_adjustments_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `salary_adjustments_ibfk_3` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `salary_advances`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `salary_advances` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `branch_id` int(11) NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `reason` text DEFAULT NULL,
  `status` enum('pending','approved','rejected','paid','recovered') DEFAULT 'pending',
  `approved_by` int(11) DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `rejected_by` int(11) DEFAULT NULL,
  `rejected_at` datetime DEFAULT NULL,
  `rejection_reason` text DEFAULT NULL,
  `payment_date` date DEFAULT NULL,
  `payment_method` varchar(50) DEFAULT NULL,
  `payment_reference` varchar(100) DEFAULT NULL,
  `paid_by` int(11) DEFAULT NULL,
  `recovery_month` varchar(7) DEFAULT NULL COMMENT 'YYYY-MM format',
  `recovered_amount` decimal(12,2) DEFAULT 0.00,
  `notes` text DEFAULT NULL,
  `requested_by` int(11) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `approved_by` (`approved_by`),
  KEY `rejected_by` (`rejected_by`),
  KEY `paid_by` (`paid_by`),
  KEY `requested_by` (`requested_by`),
  KEY `idx_status` (`status`),
  KEY `idx_user` (`user_id`),
  KEY `idx_branch` (`branch_id`),
  KEY `idx_recovery_month` (`recovery_month`),
  CONSTRAINT `salary_advances_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `salary_advances_ibfk_2` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`) ON DELETE CASCADE,
  CONSTRAINT `salary_advances_ibfk_3` FOREIGN KEY (`approved_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `salary_advances_ibfk_4` FOREIGN KEY (`rejected_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `salary_advances_ibfk_5` FOREIGN KEY (`paid_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `salary_advances_ibfk_6` FOREIGN KEY (`requested_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `salary_payments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `salary_payments` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `monthly_salary_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `payment_date` date NOT NULL,
  `amount_paid` decimal(10,2) NOT NULL,
  `payment_method` enum('cash','bank_transfer','upi','cheque','other') NOT NULL,
  `payment_reference` varchar(100) DEFAULT NULL,
  `bank_name` varchar(100) DEFAULT NULL,
  `account_number` varchar(50) DEFAULT NULL,
  `transaction_id` varchar(100) DEFAULT NULL,
  `receipt_number` varchar(50) DEFAULT NULL,
  `receipt_photo` varchar(500) DEFAULT NULL,
  `is_verified` tinyint(1) DEFAULT 0,
  `verified_by` int(11) DEFAULT NULL,
  `verified_at` timestamp NULL DEFAULT NULL,
  `paid_by` int(11) NOT NULL,
  `paid_at` timestamp NULL DEFAULT current_timestamp(),
  `notes` text DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `paid_by` (`paid_by`),
  KEY `verified_by` (`verified_by`),
  KEY `idx_monthly_salary` (`monthly_salary_id`),
  KEY `idx_user` (`user_id`),
  KEY `idx_payment_date` (`payment_date`),
  KEY `idx_payment_method` (`payment_method`),
  KEY `idx_sp_transaction` (`transaction_id`),
  CONSTRAINT `salary_payments_ibfk_1` FOREIGN KEY (`monthly_salary_id`) REFERENCES `monthly_salaries` (`id`) ON DELETE CASCADE,
  CONSTRAINT `salary_payments_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `salary_payments_ibfk_3` FOREIGN KEY (`paid_by`) REFERENCES `users` (`id`),
  CONSTRAINT `salary_payments_ibfk_4` FOREIGN KEY (`verified_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `settings` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `setting_key` varchar(100) NOT NULL,
  `setting_value` mediumtext DEFAULT NULL,
  `category` varchar(50) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `setting_key` (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `share_tokens`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `share_tokens` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `token` varchar(64) NOT NULL,
  `resource_type` varchar(50) NOT NULL,
  `resource_id` int(11) NOT NULL,
  `created_by` int(11) NOT NULL,
  `expires_at` timestamp NULL DEFAULT NULL,
  `view_count` int(11) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_token` (`token`),
  KEY `idx_resource` (`resource_type`,`resource_id`),
  KEY `idx_expires` (`expires_at`),
  KEY `idx_created_by` (`created_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `shop_hours_config`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `shop_hours_config` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `branch_id` int(11) NOT NULL,
  `day_of_week` enum('monday','tuesday','wednesday','thursday','friday','saturday','sunday') NOT NULL,
  `is_open` tinyint(1) DEFAULT 1,
  `open_time` time DEFAULT '08:30:00',
  `close_time` time DEFAULT '20:30:00',
  `expected_hours` decimal(4,2) DEFAULT 10.00,
  `is_working_day` tinyint(1) DEFAULT 1,
  `break_min_minutes` int(11) DEFAULT 60,
  `break_max_minutes` int(11) DEFAULT 120,
  `late_threshold_minutes` int(11) DEFAULT 15,
  `break_allowance_minutes` int(11) DEFAULT 120,
  `break_warning_minutes` int(11) DEFAULT 90,
  `ot_auto_timeout_minutes` int(11) DEFAULT 15,
  `ot_approval_required` tinyint(1) DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_branch_day` (`branch_id`,`day_of_week`),
  KEY `idx_branch` (`branch_id`),
  CONSTRAINT `shop_hours_config_ibfk_1` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Branch-wise shop hours and attendance policies';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `staff_activities`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `staff_activities` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `branch_id` int(11) DEFAULT NULL,
  `activity_date` date NOT NULL,
  `activity_time` time NOT NULL,
  `activity_type` varchar(50) NOT NULL,
  `title` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `customer_name` varchar(255) DEFAULT NULL,
  `customer_phone` varchar(20) DEFAULT NULL,
  `location` text DEFAULT NULL,
  `latitude` decimal(10,8) DEFAULT NULL,
  `longitude` decimal(11,8) DEFAULT NULL,
  `start_time` time DEFAULT NULL,
  `end_time` time DEFAULT NULL,
  `duration_minutes` int(11) DEFAULT NULL,
  `outcome` text DEFAULT NULL,
  `status` varchar(20) DEFAULT 'completed',
  `photo_url` varchar(500) DEFAULT NULL,
  `document_url` varchar(500) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `branch_id` (`branch_id`),
  KEY `idx_user_date` (`user_id`,`activity_date`),
  KEY `idx_type` (`activity_type`),
  CONSTRAINT `staff_activities_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `staff_activities_ibfk_2` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `staff_activity_feed`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `staff_activity_feed` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `branch_id` int(11) DEFAULT NULL,
  `activity_type` varchar(50) NOT NULL,
  `title` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `icon` varchar(10) DEFAULT NULL,
  `color` varchar(20) DEFAULT '#667eea',
  `visible_to` enum('all','branch','admin') DEFAULT 'all',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_branch_date` (`branch_id`,`created_at`),
  KEY `idx_type` (`activity_type`),
  KEY `idx_created` (`created_at`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `staff_activity_feed_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `staff_activity_sessions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `staff_activity_sessions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `branch_id` int(11) NOT NULL,
  `activity_type` enum('marketing','outstanding_followup','material_arrangement','material_receiving','attending_customer','shop_maintenance') NOT NULL,
  `started_at` datetime NOT NULL,
  `ended_at` datetime DEFAULT NULL,
  `duration_minutes` int(11) DEFAULT NULL,
  `auto_ended` tinyint(1) DEFAULT 0,
  `metadata` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`metadata`)),
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_user_started` (`user_id`,`started_at`),
  KEY `idx_user_ended` (`user_id`,`ended_at`),
  KEY `idx_branch_started` (`branch_id`,`started_at`),
  CONSTRAINT `fk_activity_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `staff_agreement_records`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `staff_agreement_records` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `agreement_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `status` enum('pending','viewed','uploaded') DEFAULT 'pending',
  `viewed_at` datetime DEFAULT NULL,
  `signed_document` varchar(500) DEFAULT NULL,
  `uploaded_at` datetime DEFAULT NULL,
  `assigned_by` int(11) DEFAULT NULL,
  `assigned_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `staff_agreements`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `staff_agreements` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `title` varchar(255) NOT NULL DEFAULT 'வேலை ஒப்பந்தம்',
  `version` varchar(20) NOT NULL DEFAULT 'v1.0',
  `is_active` tinyint(1) DEFAULT 1,
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `staff_attendance`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `staff_attendance` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `branch_id` int(11) NOT NULL,
  `date` date NOT NULL,
  `clock_in_time` datetime DEFAULT NULL,
  `clock_in_photo` varchar(500) DEFAULT NULL,
  `clock_in_lat` decimal(10,8) DEFAULT NULL,
  `clock_in_lng` decimal(11,8) DEFAULT NULL,
  `clock_in_address` text DEFAULT NULL,
  `clock_out_time` datetime DEFAULT NULL,
  `clock_out_photo` varchar(500) DEFAULT NULL,
  `clock_out_lat` decimal(10,8) DEFAULT NULL,
  `clock_out_lng` decimal(11,8) DEFAULT NULL,
  `clock_out_address` text DEFAULT NULL,
  `break_start_time` datetime DEFAULT NULL,
  `break_end_time` datetime DEFAULT NULL,
  `break_duration_minutes` int(11) DEFAULT 0,
  `outside_work_minutes` int(11) DEFAULT 0,
  `prayer_minutes` int(11) DEFAULT 0,
  `overtime_minutes` int(11) DEFAULT 0,
  `overtime_started_at` datetime DEFAULT NULL,
  `overtime_acknowledged` tinyint(1) DEFAULT 0,
  `overtime_acknowledged_at` datetime DEFAULT NULL,
  `ot_request_id` int(11) DEFAULT NULL,
  `ot_request_status` enum('none','pending','approved','rejected') DEFAULT 'none',
  `ot_approved_minutes` int(11) DEFAULT 0,
  `ot_prompt_shown_at` datetime DEFAULT NULL,
  `total_working_minutes` int(11) DEFAULT 0,
  `expected_hours` decimal(4,2) DEFAULT 10.00,
  `status` enum('present','absent','half_day','on_leave','holiday') DEFAULT 'present',
  `is_late` tinyint(1) DEFAULT 0,
  `is_early_checkout` tinyint(1) DEFAULT 0,
  `late_permission_id` int(11) DEFAULT NULL,
  `early_checkout_permission_id` int(11) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `geo_fence_status` enum('inside','outside','not_checked') DEFAULT 'not_checked',
  `geo_fence_distance` int(11) DEFAULT NULL,
  `total_break_minutes` int(11) DEFAULT 0,
  `late_minutes` int(11) DEFAULT 0,
  `late_penalty_minutes` int(11) DEFAULT 0 COMMENT 'Attendance minutes deducted as late penalty',
  `break_start_photo` varchar(500) DEFAULT NULL,
  `break_end_photo` varchar(500) DEFAULT NULL,
  `break_start_lat` decimal(10,8) DEFAULT NULL,
  `break_start_lng` decimal(11,8) DEFAULT NULL,
  `break_end_lat` decimal(10,8) DEFAULT NULL,
  `break_end_lng` decimal(11,8) DEFAULT NULL,
  `clock_in_distance` int(11) DEFAULT NULL,
  `clock_out_distance` int(11) DEFAULT NULL,
  `allow_reclockin` tinyint(4) DEFAULT 0,
  `is_reclockin` tinyint(4) DEFAULT 0,
  `is_overtime` tinyint(4) DEFAULT 0,
  `auto_clockout_type` enum('geo','max_hours','admin','end_of_day','ot_timeout','location_off') DEFAULT NULL,
  `auto_clockout_distance` int(11) DEFAULT NULL,
  `break_allowance_minutes` int(11) DEFAULT 120,
  `break_warning_sent` tinyint(1) DEFAULT 0,
  `excess_break_minutes` int(11) DEFAULT 0,
  `break_exceeded` tinyint(1) DEFAULT 0,
  `effective_working_minutes` int(11) DEFAULT NULL,
  `manual_adjustment_minutes` int(11) DEFAULT 0,
  `adjusted_by` int(11) DEFAULT NULL,
  `adjustment_reason` varchar(500) DEFAULT NULL,
  `geo_warning_started_at` datetime DEFAULT NULL,
  `last_geo_check_at` datetime DEFAULT NULL,
  `last_geo_distance` int(11) DEFAULT NULL,
  `location_off_at` datetime DEFAULT NULL,
  `attendance_date` date GENERATED ALWAYS AS (`date`) VIRTUAL,
  PRIMARY KEY (`id`),
  KEY `idx_user_date` (`user_id`,`date`),
  KEY `idx_date` (`date`),
  KEY `idx_status` (`status`),
  KEY `idx_branch_date` (`branch_id`,`date`),
  KEY `idx_sa_ot_req` (`ot_request_id`),
  KEY `idx_sa_late_perm` (`late_permission_id`),
  KEY `idx_sa_early_perm` (`early_checkout_permission_id`),
  KEY `idx_staff_attn_user_date` (`user_id`,`date`),
  CONSTRAINT `staff_attendance_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `staff_attendance_ibfk_2` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Daily attendance records with clock in/out times';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `staff_daily_ai_tasks`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `staff_daily_ai_tasks` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `task_date` date NOT NULL,
  `tasks_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL COMMENT 'Array of {title, description, category, priority, completed}' CHECK (json_valid(`tasks_json`)),
  `summary` text DEFAULT NULL COMMENT 'Tamil summary from Clawdbot',
  `lead_context` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT 'Snapshot of leads/outstanding data used for generation' CHECK (json_valid(`lead_context`)),
  `generated_at` timestamp NULL DEFAULT current_timestamp(),
  `completed_count` int(11) DEFAULT 0,
  `total_count` int(11) DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_date` (`user_id`,`task_date`),
  KEY `idx_user_date` (`user_id`,`task_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `staff_eod_submissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `staff_eod_submissions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `attendance_id` int(11) DEFAULT NULL,
  `report_date` date NOT NULL,
  `tasks` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`tasks`)),
  `marketing_lead_ids` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`marketing_lead_ids`)),
  `credit_reminder_ids` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`credit_reminder_ids`)),
  `total_customers_served` int(11) DEFAULT 0,
  `notes` text DEFAULT NULL,
  `submitted_at` datetime NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_eod` (`user_id`,`report_date`),
  KEY `idx_user_date` (`user_id`,`report_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `staff_idle_alerts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `staff_idle_alerts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `idle_started_at` datetime NOT NULL,
  `alert_sent_at` datetime NOT NULL,
  `responded_at` datetime DEFAULT NULL,
  `idle_minutes` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_user_alert` (`user_id`,`alert_sent_at`),
  CONSTRAINT `fk_idle_alerts_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `staff_incentives`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `staff_incentives` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `lead_id` int(11) DEFAULT NULL,
  `customer_id` int(11) DEFAULT NULL,
  `estimate_id` int(11) DEFAULT NULL,
  `estimate_amount` decimal(12,2) DEFAULT NULL,
  `source` enum('auto_estimate','manual_request','admin_added','painter_convert') DEFAULT 'admin_added',
  `invoice_reference` varchar(100) DEFAULT NULL,
  `lead_type` enum('customer','painter','engineer') NOT NULL,
  `incentive_month` varchar(7) NOT NULL COMMENT 'YYYY-MM format',
  `amount` decimal(10,2) NOT NULL DEFAULT 0.00,
  `status` enum('pending','approved','rejected') DEFAULT 'pending',
  `notes` text DEFAULT NULL,
  `approved_by` int(11) DEFAULT NULL,
  `approved_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_user_month` (`user_id`,`incentive_month`),
  KEY `idx_lead` (`lead_id`),
  KEY `idx_status` (`status`),
  KEY `approved_by` (`approved_by`),
  CONSTRAINT `staff_incentives_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `staff_incentives_ibfk_2` FOREIGN KEY (`lead_id`) REFERENCES `leads` (`id`),
  CONSTRAINT `staff_incentives_ibfk_3` FOREIGN KEY (`approved_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `staff_leave_balance`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `staff_leave_balance` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `year` int(11) NOT NULL,
  `total_annual_leaves` int(11) DEFAULT 12,
  `total_sick_leaves` int(11) DEFAULT 6,
  `total_casual_leaves` int(11) DEFAULT 6,
  `used_annual_leaves` int(11) DEFAULT 0,
  `used_sick_leaves` int(11) DEFAULT 0,
  `used_casual_leaves` int(11) DEFAULT 0,
  `remaining_annual_leaves` int(11) GENERATED ALWAYS AS (`total_annual_leaves` - `used_annual_leaves`) STORED,
  `remaining_sick_leaves` int(11) GENERATED ALWAYS AS (`total_sick_leaves` - `used_sick_leaves`) STORED,
  `remaining_casual_leaves` int(11) GENERATED ALWAYS AS (`total_casual_leaves` - `used_casual_leaves`) STORED,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_user_year` (`user_id`,`year`),
  KEY `idx_year` (`year`),
  CONSTRAINT `staff_leave_balance_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `staff_registrations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `staff_registrations` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `full_name` varchar(100) NOT NULL,
  `email` varchar(255) NOT NULL,
  `phone` varchar(15) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `date_of_birth` date DEFAULT NULL,
  `door_no` varchar(50) DEFAULT NULL,
  `street` varchar(100) DEFAULT NULL,
  `city` varchar(100) DEFAULT NULL,
  `state` varchar(100) DEFAULT 'Tamil Nadu',
  `pincode` varchar(10) DEFAULT NULL,
  `aadhar_number` varchar(12) DEFAULT NULL,
  `aadhar_proof_url` varchar(500) DEFAULT NULL,
  `pan_number` varchar(10) DEFAULT NULL,
  `pan_proof_url` varchar(500) DEFAULT NULL,
  `emergency_contact_name` varchar(100) DEFAULT NULL,
  `emergency_contact_phone` varchar(15) DEFAULT NULL,
  `phone_verified` tinyint(1) DEFAULT 0,
  `otp_id` int(11) DEFAULT NULL,
  `status` enum('pending','approved','rejected') DEFAULT 'pending',
  `assigned_role` varchar(50) DEFAULT NULL,
  `assigned_branch_id` int(11) DEFAULT NULL,
  `approved_by` int(11) DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `rejected_by` int(11) DEFAULT NULL,
  `rejected_at` datetime DEFAULT NULL,
  `rejection_reason` text DEFAULT NULL,
  `offer_letter_url` varchar(500) DEFAULT NULL,
  `offer_letter_sent` tinyint(1) DEFAULT 0,
  `offer_letter_sent_at` datetime DEFAULT NULL,
  `joining_date` date DEFAULT NULL,
  `monthly_salary` decimal(10,2) DEFAULT NULL,
  `transport_allowance` decimal(10,2) DEFAULT 0.00,
  `food_allowance` decimal(10,2) DEFAULT 0.00,
  `other_allowance` decimal(10,2) DEFAULT 0.00,
  `created_user_id` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `offer_letter_content` text DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_status` (`status`),
  KEY `idx_phone` (`phone`),
  KEY `idx_email` (`email`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_staff_reg_otp` (`otp_id`),
  KEY `idx_staff_reg_branch` (`assigned_branch_id`),
  KEY `idx_sr_created_user` (`created_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `staff_salary_config`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `staff_salary_config` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `branch_id` int(11) NOT NULL,
  `monthly_salary` decimal(10,2) NOT NULL,
  `hourly_rate` decimal(10,2) GENERATED ALWAYS AS (`monthly_salary` / 260) STORED,
  `overtime_multiplier` decimal(3,2) DEFAULT 1.50,
  `standard_daily_hours` decimal(4,2) DEFAULT 10.00,
  `sunday_hours` decimal(4,2) DEFAULT 5.00,
  `enable_late_deduction` tinyint(1) DEFAULT 1,
  `late_deduction_per_hour` decimal(10,2) DEFAULT 0.00,
  `enable_absence_deduction` tinyint(1) DEFAULT 1,
  `transport_allowance` decimal(10,2) DEFAULT 0.00,
  `food_allowance` decimal(10,2) DEFAULT 0.00,
  `other_allowance` decimal(10,2) DEFAULT 0.00,
  `allowance_notes` text DEFAULT NULL,
  `effective_from` date NOT NULL,
  `effective_until` date DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  `created_by` int(11) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `created_by` (`created_by`),
  KEY `idx_user_active` (`user_id`,`is_active`),
  KEY `idx_branch` (`branch_id`),
  KEY `idx_effective_dates` (`effective_from`,`effective_until`),
  CONSTRAINT `staff_salary_config_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `staff_salary_config_ibfk_2` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`),
  CONSTRAINT `staff_salary_config_ibfk_3` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `staff_tasks`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `staff_tasks` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `task_number` varchar(50) DEFAULT NULL,
  `title` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `task_type` varchar(20) DEFAULT 'daily',
  `priority` varchar(20) DEFAULT 'medium',
  `category` varchar(100) DEFAULT NULL,
  `assigned_to` int(11) NOT NULL,
  `assigned_by` int(11) NOT NULL,
  `branch_id` int(11) DEFAULT NULL,
  `due_date` date NOT NULL,
  `due_time` time DEFAULT NULL,
  `start_date` date DEFAULT NULL,
  `estimated_hours` decimal(4,2) DEFAULT NULL,
  `status` varchar(20) DEFAULT 'pending',
  `completion_percentage` int(11) DEFAULT 0,
  `completed_at` datetime DEFAULT NULL,
  `actual_hours` decimal(4,2) DEFAULT NULL,
  `staff_notes` text DEFAULT NULL,
  `admin_notes` text DEFAULT NULL,
  `rating` int(11) DEFAULT NULL,
  `rating_notes` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `task_number` (`task_number`),
  KEY `assigned_by` (`assigned_by`),
  KEY `branch_id` (`branch_id`),
  KEY `idx_assigned_to` (`assigned_to`),
  KEY `idx_status` (`status`),
  KEY `idx_due_date` (`due_date`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_st_assigned_status_due` (`assigned_to`,`status`,`due_date`),
  CONSTRAINT `staff_tasks_ibfk_1` FOREIGN KEY (`assigned_to`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `staff_tasks_ibfk_2` FOREIGN KEY (`assigned_by`) REFERENCES `users` (`id`),
  CONSTRAINT `staff_tasks_ibfk_3` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `stock_check_assignments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `stock_check_assignments` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `branch_id` int(11) NOT NULL,
  `zoho_location_id` varchar(50) DEFAULT NULL,
  `staff_id` int(11) NOT NULL,
  `check_date` date NOT NULL,
  `status` enum('pending','submitted','reviewed','adjusted','cancelled') DEFAULT 'pending',
  `request_type` enum('admin_assigned','self_requested') DEFAULT 'admin_assigned',
  `show_system_qty` tinyint(1) DEFAULT 0,
  `notes` text DEFAULT NULL,
  `requested_reason` text DEFAULT NULL,
  `submitted_at` datetime DEFAULT NULL,
  `reviewed_by` int(11) DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  `adjustment_id` varchar(1000) DEFAULT NULL,
  `created_by` int(11) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `cancelled_by` int(11) DEFAULT NULL,
  `cancelled_at` datetime DEFAULT NULL,
  `cancel_reason` varchar(500) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_sca_branch_date` (`branch_id`,`check_date`),
  KEY `idx_sca_staff_date` (`staff_id`,`check_date`),
  KEY `idx_sca_status` (`status`),
  KEY `idx_sca_zoho_loc` (`zoho_location_id`),
  KEY `idx_sca_adjustment` (`adjustment_id`(768)),
  KEY `idx_submitted_at` (`submitted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `stock_check_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `stock_check_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `assignment_id` int(11) NOT NULL,
  `zoho_item_id` varchar(50) NOT NULL,
  `item_name` varchar(255) DEFAULT NULL,
  `item_sku` varchar(100) DEFAULT NULL,
  `system_qty` decimal(12,2) DEFAULT 0.00,
  `reported_qty` decimal(12,2) DEFAULT NULL,
  `difference` decimal(12,2) DEFAULT NULL,
  `variance_pct` decimal(8,2) DEFAULT NULL,
  `photo_url` varchar(500) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `item_status` enum('pending','checked','submitted','adjusted') DEFAULT 'pending',
  `submitted_at` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_sci_assignment` (`assignment_id`),
  KEY `idx_sci_zoho_item` (`zoho_item_id`),
  KEY `idx_item_status` (`assignment_id`,`item_status`),
  CONSTRAINT `stock_check_items_ibfk_1` FOREIGN KEY (`assignment_id`) REFERENCES `stock_check_assignments` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `stock_verifications`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `stock_verifications` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `zoho_item_id` varchar(50) NOT NULL,
  `zoho_location_id` varchar(50) NOT NULL,
  `branch_id` int(11) DEFAULT NULL,
  `verified_by` int(11) NOT NULL,
  `verified_at` timestamp NULL DEFAULT current_timestamp(),
  `system_stock` decimal(12,2) DEFAULT NULL,
  `physical_stock` decimal(12,2) DEFAULT NULL,
  `match_status` enum('matches','discrepancy') NOT NULL,
  `discrepancy` decimal(12,2) DEFAULT 0.00,
  `notes` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_item_loc` (`zoho_item_id`,`zoho_location_id`),
  KEY `idx_verified_at` (`verified_at`),
  KEY `idx_branch` (`branch_id`),
  KEY `idx_verified_by` (`verified_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `system_health_checks`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `system_health_checks` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `check_type` enum('database','api_endpoints','file_system','memory','disk_space','external_services') NOT NULL,
  `status` enum('healthy','warning','critical') NOT NULL,
  `details` longtext DEFAULT NULL CHECK (json_valid(`details`)),
  `response_time_ms` int(11) DEFAULT NULL,
  `checked_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_check_type` (`check_type`),
  KEY `idx_status` (`status`),
  KEY `idx_checked_at` (`checked_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `task_updates`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `task_updates` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `task_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `update_type` varchar(30) NOT NULL,
  `old_status` varchar(50) DEFAULT NULL,
  `new_status` varchar(50) DEFAULT NULL,
  `comment` text DEFAULT NULL,
  `photo_url` varchar(500) DEFAULT NULL,
  `progress_percentage` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  KEY `idx_task` (`task_id`),
  CONSTRAINT `task_updates_ibfk_1` FOREIGN KEY (`task_id`) REFERENCES `staff_tasks` (`id`) ON DELETE CASCADE,
  CONSTRAINT `task_updates_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `user_branches`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_branches` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `branch_id` int(11) NOT NULL,
  `is_primary` tinyint(1) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_user_branch` (`user_id`,`branch_id`),
  KEY `branch_id` (`branch_id`),
  CONSTRAINT `user_branches_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `user_branches_ibfk_2` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `user_sessions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_sessions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `session_token` varchar(255) NOT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `user_agent` text DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `expires_at` datetime NOT NULL,
  `last_activity` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `token_hash` char(64) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `session_token` (`session_token`),
  KEY `user_id` (`user_id`),
  KEY `idx_session_token` (`session_token`),
  KEY `idx_expires_at` (`expires_at`),
  KEY `idx_token_hash` (`token_hash`),
  CONSTRAINT `user_sessions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `username` varchar(100) NOT NULL,
  `email` varchar(255) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `full_name` varchar(255) DEFAULT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `role` enum('admin','administrator','manager','accountant','staff','customer','guest','branch_manager','sales_staff','retail_customer','contractor','builder','dealer','super_admin') DEFAULT 'staff',
  `branch_id` int(11) DEFAULT NULL,
  `geo_fence_enabled` tinyint(1) DEFAULT 1,
  `status` enum('active','inactive','pending_approval') DEFAULT 'pending_approval',
  `salary_visible_to_staff` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` datetime DEFAULT current_timestamp(),
  `last_login` datetime DEFAULT NULL,
  `profile_image_url` mediumtext DEFAULT NULL,
  `date_of_birth` date DEFAULT NULL,
  `door_no` varchar(50) DEFAULT NULL,
  `street` varchar(100) DEFAULT NULL,
  `city` varchar(100) DEFAULT NULL,
  `state` varchar(100) DEFAULT 'Tamil Nadu',
  `pincode` varchar(10) DEFAULT NULL,
  `aadhar_number` varchar(12) DEFAULT NULL,
  `aadhar_proof_url` varchar(500) DEFAULT NULL,
  `pan_number` varchar(10) DEFAULT NULL,
  `pan_proof_url` varchar(500) DEFAULT NULL,
  `kyc_status` enum('incomplete','complete','verified') DEFAULT 'incomplete',
  `emergency_contact_name` varchar(100) DEFAULT NULL,
  `emergency_contact_phone` varchar(15) DEFAULT NULL,
  `bank_account_name` varchar(150) DEFAULT NULL,
  `bank_name` varchar(150) DEFAULT NULL,
  `bank_account_number` varchar(30) DEFAULT NULL,
  `bank_ifsc_code` varchar(11) DEFAULT NULL,
  `upi_id` varchar(100) DEFAULT NULL,
  `last_validation_check` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `is_active` tinyint(1) GENERATED ALWAYS AS (case when `status` = 'active' then 1 else 0 end) VIRTUAL,
  `totp_secret` varchar(64) DEFAULT NULL,
  `totp_enabled` tinyint(1) DEFAULT 0,
  `totp_verified_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`),
  UNIQUE KEY `email` (`email`),
  KEY `idx_role` (`role`),
  KEY `idx_status` (`status`),
  KEY `idx_email` (`email`),
  KEY `fk_user_branch` (`branch_id`),
  KEY `idx_users_upi` (`upi_id`),
  CONSTRAINT `fk_user_branch` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `vendor_bill_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `vendor_bill_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `bill_id` int(11) NOT NULL,
  `zoho_item_id` varchar(50) DEFAULT NULL,
  `item_name` varchar(255) NOT NULL,
  `quantity` decimal(10,2) NOT NULL,
  `unit_price` decimal(10,2) NOT NULL,
  `line_total` decimal(12,2) NOT NULL,
  `ai_matched` tinyint(1) DEFAULT 0,
  `ai_confidence` decimal(3,2) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_bill_id` (`bill_id`),
  CONSTRAINT `vendor_bill_items_ibfk_1` FOREIGN KEY (`bill_id`) REFERENCES `vendor_bills` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `vendor_bills`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `vendor_bills` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `vendor_id` int(11) NOT NULL,
  `bill_number` varchar(50) DEFAULT NULL,
  `bill_date` date DEFAULT NULL,
  `due_date` date DEFAULT NULL,
  `subtotal` decimal(12,2) DEFAULT 0.00,
  `tax_amount` decimal(12,2) DEFAULT 0.00,
  `grand_total` decimal(12,2) DEFAULT 0.00,
  `amount_paid` decimal(12,2) DEFAULT 0.00,
  `balance_due` decimal(12,2) DEFAULT 0.00,
  `payment_status` enum('unpaid','partial','paid') DEFAULT 'unpaid',
  `zoho_status` enum('pending','pushed','failed') DEFAULT 'pending',
  `zoho_bill_id` varchar(50) DEFAULT NULL,
  `bill_image` varchar(500) DEFAULT NULL,
  `ai_extracted_data` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`ai_extracted_data`)),
  `ai_verification_status` enum('pending','verified','mismatch','corrected') DEFAULT 'pending',
  `ai_verification_result` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`ai_verification_result`)),
  `verified_at` timestamp NULL DEFAULT NULL,
  `verified_by` int(11) DEFAULT NULL,
  `entered_by` int(11) NOT NULL,
  `notes` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_vendor_id` (`vendor_id`),
  KEY `idx_payment_status` (`payment_status`),
  KEY `idx_zoho_status` (`zoho_status`),
  KEY `idx_ai_verification_status` (`ai_verification_status`),
  KEY `idx_bill_date` (`bill_date`),
  CONSTRAINT `vendor_bills_ibfk_1` FOREIGN KEY (`vendor_id`) REFERENCES `vendors` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `vendor_mapping_scans`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `vendor_mapping_scans` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `started_at` datetime NOT NULL DEFAULT current_timestamp(),
  `completed_at` datetime DEFAULT NULL,
  `months_back` int(11) NOT NULL,
  `bills_fetched` int(11) NOT NULL DEFAULT 0,
  `items_mapped` int(11) NOT NULL DEFAULT 0,
  `status` enum('running','completed','failed') NOT NULL DEFAULT 'running',
  `error_message` text DEFAULT NULL,
  `triggered_by` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `vendor_payments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `vendor_payments` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `vendor_id` int(11) NOT NULL,
  `bill_id` int(11) DEFAULT NULL,
  `amount` decimal(12,2) NOT NULL,
  `payment_method` enum('bank_transfer','cheque','upi','cash') NOT NULL,
  `payment_reference` varchar(100) DEFAULT NULL,
  `payment_date` date NOT NULL,
  `paid_by` int(11) NOT NULL,
  `zoho_payment_id` varchar(50) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_vendor_id` (`vendor_id`),
  KEY `idx_bill_id` (`bill_id`),
  KEY `idx_payment_date` (`payment_date`),
  CONSTRAINT `vendor_payments_ibfk_1` FOREIGN KEY (`vendor_id`) REFERENCES `vendors` (`id`) ON DELETE CASCADE,
  CONSTRAINT `vendor_payments_ibfk_2` FOREIGN KEY (`bill_id`) REFERENCES `vendor_bills` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `vendor_po_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `vendor_po_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `po_id` int(11) NOT NULL,
  `zoho_item_id` varchar(50) DEFAULT NULL,
  `item_name` varchar(255) NOT NULL,
  `quantity` decimal(10,2) NOT NULL,
  `unit_price` decimal(10,2) NOT NULL,
  `line_total` decimal(12,2) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_po_id` (`po_id`),
  CONSTRAINT `vendor_po_items_ibfk_1` FOREIGN KEY (`po_id`) REFERENCES `vendor_purchase_orders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `vendor_purchase_orders`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `vendor_purchase_orders` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `po_number` varchar(20) NOT NULL,
  `vendor_id` int(11) NOT NULL,
  `created_by` int(11) NOT NULL,
  `subtotal` decimal(12,2) DEFAULT 0.00,
  `tax_amount` decimal(12,2) DEFAULT 0.00,
  `grand_total` decimal(12,2) DEFAULT 0.00,
  `status` enum('draft','sent','received','cancelled') DEFAULT 'draft',
  `source` varchar(30) NOT NULL DEFAULT 'manual',
  `source_reference` varchar(80) DEFAULT NULL,
  `zoho_po_id` varchar(50) DEFAULT NULL,
  `expected_date` date DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `estimate_id` int(11) DEFAULT NULL,
  `delivery_name` varchar(255) DEFAULT NULL,
  `delivery_phone` varchar(20) DEFAULT NULL,
  `delivery_address` text DEFAULT NULL,
  `is_third_party` tinyint(1) DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `po_number` (`po_number`),
  KEY `idx_vendor_id` (`vendor_id`),
  KEY `idx_status` (`status`),
  KEY `idx_created_by` (`created_by`),
  KEY `idx_estimate` (`estimate_id`),
  KEY `idx_source` (`source`),
  CONSTRAINT `vendor_purchase_orders_ibfk_1` FOREIGN KEY (`vendor_id`) REFERENCES `vendors` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `vendors`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `vendors` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `zoho_contact_id` varchar(50) DEFAULT NULL,
  `vendor_name` varchar(255) NOT NULL,
  `contact_person` varchar(255) DEFAULT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `email` varchar(100) DEFAULT NULL,
  `address` text DEFAULT NULL,
  `gst_number` varchar(20) DEFAULT NULL,
  `payment_terms` int(11) DEFAULT 30,
  `status` enum('active','inactive') DEFAULT 'active',
  `notes` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_zoho_contact_id` (`zoho_contact_id`),
  KEY `idx_status` (`status`),
  KEY `idx_vendor_name` (`vendor_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `wa_campaign_leads`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `wa_campaign_leads` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `campaign_id` int(11) NOT NULL,
  `lead_id` int(11) DEFAULT NULL,
  `phone` varchar(50) NOT NULL,
  `lead_name` varchar(255) DEFAULT NULL,
  `status` enum('pending','sending','sent','delivered','read','failed','skipped') DEFAULT 'pending',
  `resolved_message` text DEFAULT NULL,
  `sent_at` datetime DEFAULT NULL,
  `delivered_at` datetime DEFAULT NULL,
  `read_at` datetime DEFAULT NULL,
  `failed_at` datetime DEFAULT NULL,
  `error_message` text DEFAULT NULL,
  `retry_count` int(11) DEFAULT 0,
  `send_order` int(11) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_wcl_campaign` (`campaign_id`),
  KEY `idx_wcl_status` (`status`),
  KEY `idx_wcl_order` (`campaign_id`,`send_order`),
  KEY `idx_wcl_lead` (`lead_id`),
  CONSTRAINT `wa_campaign_leads_ibfk_1` FOREIGN KEY (`campaign_id`) REFERENCES `wa_campaigns` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `wa_campaigns`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `wa_campaigns` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `branch_id` int(11) DEFAULT NULL,
  `send_from_branch_id` int(11) DEFAULT 0,
  `status` enum('draft','scheduled','running','paused','completed','cancelled','failed') DEFAULT 'draft',
  `message_type` enum('text','image','document','location','vcard') DEFAULT 'text',
  `message_body` text DEFAULT NULL,
  `media_url` varchar(500) DEFAULT NULL,
  `media_filename` varchar(255) DEFAULT NULL,
  `media_caption` text DEFAULT NULL,
  `audience_filter` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`audience_filter`)),
  `scheduled_at` datetime DEFAULT NULL,
  `sending_started_at` datetime DEFAULT NULL,
  `completed_at` datetime DEFAULT NULL,
  `total_leads` int(11) DEFAULT 0,
  `sent_count` int(11) DEFAULT 0,
  `delivered_count` int(11) DEFAULT 0,
  `read_count` int(11) DEFAULT 0,
  `failed_count` int(11) DEFAULT 0,
  `min_delay_seconds` int(11) DEFAULT 30,
  `max_delay_seconds` int(11) DEFAULT 90,
  `hourly_limit` int(11) DEFAULT 30,
  `daily_limit` int(11) DEFAULT 200,
  `warm_up_enabled` tinyint(1) DEFAULT 0,
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_wc_status` (`status`),
  KEY `idx_wc_branch` (`branch_id`),
  KEY `idx_wc_scheduled` (`scheduled_at`),
  KEY `created_by` (`created_by`),
  CONSTRAINT `wa_campaigns_ibfk_2` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `wa_contact_group_members`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `wa_contact_group_members` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `group_id` int(11) NOT NULL,
  `phone` varchar(50) NOT NULL,
  `added_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_group_phone` (`group_id`,`phone`),
  CONSTRAINT `wa_contact_group_members_ibfk_1` FOREIGN KEY (`group_id`) REFERENCES `wa_contact_groups` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `wa_contact_groups`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `wa_contact_groups` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `description` varchar(500) DEFAULT NULL,
  `color` varchar(7) DEFAULT '#6366F1',
  `member_count` int(11) DEFAULT 0,
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `created_by` (`created_by`),
  CONSTRAINT `wa_contact_groups_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `wa_instant_messages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `wa_instant_messages` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `batch_id` varchar(50) NOT NULL,
  `lead_id` int(11) DEFAULT NULL,
  `lead_name` varchar(255) DEFAULT NULL,
  `phone` varchar(50) NOT NULL,
  `message_template` text DEFAULT NULL,
  `message_content` text DEFAULT NULL,
  `media_url` varchar(500) DEFAULT NULL,
  `media_type` enum('image','document') DEFAULT NULL,
  `media_caption` text DEFAULT NULL,
  `branch_id` int(11) DEFAULT NULL,
  `status` enum('pending','sending','sent','delivered','read','failed') DEFAULT 'pending',
  `error_message` text DEFAULT NULL,
  `sent_at` datetime DEFAULT NULL,
  `delivered_at` datetime DEFAULT NULL,
  `read_at` datetime DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_wim_batch` (`batch_id`),
  KEY `idx_wim_status` (`status`),
  KEY `idx_wim_lead` (`lead_id`),
  KEY `idx_wim_created` (`created_at`),
  KEY `idx_wim_created_by` (`created_by`),
  KEY `branch_id` (`branch_id`),
  CONSTRAINT `wa_instant_messages_ibfk_2` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `wa_marketing_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `wa_marketing_settings` (
  `key` varchar(100) NOT NULL,
  `value` text NOT NULL,
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `wa_message_templates`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `wa_message_templates` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `category` enum('greeting','promotion','followup','announcement','festival','custom') DEFAULT 'custom',
  `message_type` enum('text','image','document','location','vcard') DEFAULT 'text',
  `message_body` text DEFAULT NULL,
  `media_url` varchar(500) DEFAULT NULL,
  `media_caption` text DEFAULT NULL,
  `variables_used` varchar(500) DEFAULT NULL,
  `usage_count` int(11) DEFAULT 0,
  `is_active` tinyint(1) DEFAULT 1,
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_wmt_category` (`category`),
  KEY `idx_wmt_active` (`is_active`),
  KEY `created_by` (`created_by`),
  CONSTRAINT `wa_message_templates_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `wa_sending_stats`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `wa_sending_stats` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `branch_id` int(11) DEFAULT NULL,
  `stat_date` date NOT NULL,
  `stat_hour` tinyint(4) NOT NULL,
  `messages_sent` int(11) DEFAULT 0,
  `messages_failed` int(11) DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_branch_date_hour` (`branch_id`,`stat_date`,`stat_hour`),
  KEY `idx_wss_date` (`stat_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `website_features`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `website_features` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `title` varchar(255) NOT NULL,
  `title_tamil` varchar(255) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `description_tamil` text DEFAULT NULL,
  `icon` varchar(50) DEFAULT 'check-circle',
  `color` varchar(20) DEFAULT 'green',
  `sort_order` int(11) DEFAULT 0,
  `status` enum('active','inactive') DEFAULT 'active',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `website_gallery`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `website_gallery` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `image_url` varchar(500) NOT NULL,
  `caption` varchar(255) DEFAULT NULL,
  `category` varchar(50) DEFAULT 'general',
  `sort_order` int(11) DEFAULT 0,
  `status` enum('active','inactive') DEFAULT 'active',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `website_services`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `website_services` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `title` varchar(255) NOT NULL,
  `title_tamil` varchar(255) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `description_tamil` text DEFAULT NULL,
  `icon` varchar(50) DEFAULT 'paint-brush',
  `sort_order` int(11) DEFAULT 0,
  `status` enum('active','inactive') DEFAULT 'active',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `website_testimonials`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `website_testimonials` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `customer_name` varchar(255) NOT NULL,
  `customer_role` varchar(100) DEFAULT NULL,
  `customer_photo` varchar(500) DEFAULT NULL,
  `testimonial_text` text NOT NULL,
  `testimonial_text_tamil` text DEFAULT NULL,
  `rating` tinyint(4) DEFAULT 5,
  `sort_order` int(11) DEFAULT 0,
  `status` enum('active','inactive') DEFAULT 'active',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `whatsapp_contacts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `whatsapp_contacts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `branch_id` int(11) NOT NULL,
  `phone_number` varchar(255) NOT NULL,
  `pushname` varchar(255) DEFAULT NULL,
  `saved_name` varchar(255) DEFAULT NULL,
  `profile_pic_url` varchar(500) DEFAULT NULL,
  `last_message_at` datetime DEFAULT NULL,
  `unread_count` int(11) DEFAULT 0,
  `is_pinned` tinyint(1) DEFAULT 0,
  `is_muted` tinyint(1) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_wc_branch_phone` (`branch_id`,`phone_number`),
  KEY `idx_wc_last_msg` (`last_message_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `whatsapp_followups`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `whatsapp_followups` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `customer_id` int(11) DEFAULT NULL,
  `zoho_customer_id` varchar(50) DEFAULT NULL,
  `zoho_invoice_id` varchar(50) DEFAULT NULL,
  `customer_name` varchar(255) DEFAULT NULL,
  `phone` varchar(255) NOT NULL,
  `message_type` enum('payment_reminder','overdue_notice','thank_you','custom','followup') DEFAULT 'payment_reminder',
  `message_body` text NOT NULL,
  `amount` decimal(12,2) DEFAULT NULL,
  `status` enum('pending','sent','failed','cancelled') DEFAULT 'pending',
  `scheduled_at` datetime DEFAULT NULL,
  `sent_at` datetime DEFAULT NULL,
  `error_message` text DEFAULT NULL,
  `retry_count` int(11) DEFAULT 0,
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `branch_id` int(11) DEFAULT NULL,
  `sending_claimed_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_status` (`status`),
  KEY `idx_scheduled` (`scheduled_at`),
  KEY `idx_phone` (`phone`),
  KEY `customer_id` (`customer_id`),
  KEY `created_by` (`created_by`),
  KEY `idx_wf_branch` (`branch_id`),
  KEY `idx_wf_zoho_customer` (`zoho_customer_id`),
  KEY `idx_wf_zoho_invoice` (`zoho_invoice_id`),
  KEY `idx_wf_claim` (`status`,`sending_claimed_at`),
  CONSTRAINT `whatsapp_followups_ibfk_1` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE SET NULL,
  CONSTRAINT `whatsapp_followups_ibfk_2` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `whatsapp_messages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `whatsapp_messages` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `branch_id` int(11) NOT NULL,
  `phone_number` varchar(255) NOT NULL,
  `direction` enum('in','out') NOT NULL,
  `message_type` enum('text','image','document','audio','video','sticker','location','contact','unknown') DEFAULT 'text',
  `body` text DEFAULT NULL,
  `media_url` varchar(500) DEFAULT NULL,
  `media_mime_type` varchar(100) DEFAULT NULL,
  `media_filename` varchar(255) DEFAULT NULL,
  `caption` text DEFAULT NULL,
  `whatsapp_msg_id` varchar(100) DEFAULT NULL,
  `status` enum('pending','sent','delivered','read','failed') DEFAULT 'sent',
  `sender_name` varchar(255) DEFAULT NULL,
  `is_group` tinyint(1) DEFAULT 0,
  `quoted_msg_id` varchar(100) DEFAULT NULL,
  `timestamp` datetime NOT NULL,
  `is_read` tinyint(1) DEFAULT 0,
  `sent_by` int(11) DEFAULT NULL,
  `source` varchar(50) DEFAULT 'incoming',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_wm_branch_phone` (`branch_id`,`phone_number`),
  KEY `idx_wm_timestamp` (`timestamp`),
  KEY `idx_wm_wa_id` (`whatsapp_msg_id`),
  KEY `idx_wm_unread` (`branch_id`,`direction`,`is_read`),
  KEY `sent_by` (`sent_by`),
  KEY `idx_wm_quoted` (`quoted_msg_id`),
  KEY `idx_wm_branch_created` (`branch_id`,`created_at`),
  CONSTRAINT `whatsapp_messages_ibfk_2` FOREIGN KEY (`sent_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `whatsapp_sessions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `whatsapp_sessions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `branch_id` int(11) NOT NULL,
  `session_name` varchar(100) DEFAULT NULL,
  `status` enum('disconnected','qr_pending','connecting','connected','failed') DEFAULT 'disconnected',
  `phone_number` varchar(255) DEFAULT NULL,
  `connected_at` datetime DEFAULT NULL,
  `disconnected_at` datetime DEFAULT NULL,
  `last_error` text DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_ws_branch` (`branch_id`),
  KEY `created_by` (`created_by`),
  CONSTRAINT `whatsapp_sessions_ibfk_2` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `zoho_branch_allocations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `zoho_branch_allocations` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `branch_name` varchar(100) NOT NULL,
  `zoho_location_id` varchar(50) DEFAULT NULL,
  `allocation_pct` decimal(5,2) NOT NULL,
  `min_stock` int(11) NOT NULL DEFAULT 5,
  `is_active` tinyint(1) DEFAULT 1,
  `sort_order` int(11) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_branch` (`branch_name`),
  KEY `idx_zba_zoho_loc` (`zoho_location_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `zoho_bulk_job_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `zoho_bulk_job_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `job_id` int(11) NOT NULL,
  `zoho_item_id` varchar(50) NOT NULL,
  `item_name` varchar(255) DEFAULT NULL,
  `payload` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT 'Data to send to Zoho API' CHECK (json_valid(`payload`)),
  `status` enum('pending','processing','completed','failed','skipped') DEFAULT 'pending',
  `attempts` int(11) DEFAULT 0,
  `error_message` text DEFAULT NULL,
  `response_data` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`response_data`)),
  `processed_at` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_job_id` (`job_id`),
  KEY `idx_status` (`status`),
  KEY `idx_zoho_item` (`zoho_item_id`),
  CONSTRAINT `zoho_bulk_job_items_ibfk_1` FOREIGN KEY (`job_id`) REFERENCES `zoho_bulk_jobs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `zoho_bulk_jobs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `zoho_bulk_jobs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `job_type` enum('item_update','price_update','stock_adjustment') NOT NULL DEFAULT 'item_update',
  `status` enum('pending','processing','completed','failed','cancelled') DEFAULT 'pending',
  `total_items` int(11) DEFAULT 0,
  `processed_items` int(11) DEFAULT 0,
  `failed_items` int(11) DEFAULT 0,
  `skipped_items` int(11) DEFAULT 0,
  `filter_criteria` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT 'Filters used to select items' CHECK (json_valid(`filter_criteria`)),
  `update_fields` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT 'Fields and values being updated' CHECK (json_valid(`update_fields`)),
  `error_message` text DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `started_at` datetime DEFAULT NULL,
  `completed_at` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_status` (`status`),
  KEY `idx_created_by` (`created_by`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `zoho_bulk_jobs_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `zoho_category_defaults`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `zoho_category_defaults` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `category_name` varchar(100) NOT NULL,
  `default_reorder_qty` int(11) NOT NULL DEFAULT 10,
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `category_name` (`category_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `zoho_config`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `zoho_config` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `config_key` varchar(100) NOT NULL,
  `config_value` text DEFAULT NULL,
  `description` varchar(255) DEFAULT NULL,
  `updated_by` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_config_key` (`config_key`),
  KEY `updated_by` (`updated_by`),
  CONSTRAINT `zoho_config_ibfk_1` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `zoho_credit_notes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `zoho_credit_notes` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `creditnote_id` varchar(100) NOT NULL,
  `creditnote_number` varchar(100) DEFAULT NULL,
  `customer_name` varchar(200) DEFAULT NULL,
  `customer_id` varchar(100) DEFAULT NULL,
  `date` date DEFAULT NULL,
  `total` decimal(12,2) DEFAULT 0.00,
  `balance` decimal(12,2) DEFAULT 0.00,
  `status` varchar(50) DEFAULT NULL,
  `currency_code` varchar(10) DEFAULT 'INR',
  `synced_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `creditnote_id` (`creditnote_id`),
  KEY `idx_date` (`date`),
  KEY `idx_customer` (`customer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `zoho_customers_map`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `zoho_customers_map` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `local_customer_id` int(11) DEFAULT NULL,
  `zoho_contact_id` varchar(50) NOT NULL,
  `zoho_contact_name` varchar(255) DEFAULT NULL,
  `zoho_email` varchar(255) DEFAULT NULL,
  `zoho_phone` varchar(50) DEFAULT NULL,
  `zoho_gst_no` varchar(20) DEFAULT NULL,
  `zoho_outstanding` decimal(12,2) DEFAULT 0.00,
  `zoho_unused_credits` decimal(12,2) DEFAULT 0.00,
  `last_synced_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `branch_id` int(11) DEFAULT NULL,
  `credit_limit` decimal(12,2) DEFAULT 0.00,
  `credit_limit_updated_at` datetime DEFAULT NULL,
  `credit_limit_updated_by` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_zoho_contact` (`zoho_contact_id`),
  KEY `idx_local_customer` (`local_customer_id`),
  KEY `idx_zcm_branch` (`branch_id`),
  KEY `idx_zcm_credit_limit` (`credit_limit`),
  CONSTRAINT `zoho_customers_map_ibfk_1` FOREIGN KEY (`local_customer_id`) REFERENCES `customers` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `zoho_daily_transaction_details`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `zoho_daily_transaction_details` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `daily_transaction_id` int(11) NOT NULL,
  `transaction_type` enum('invoice','bill','sales_order','purchase_order','payment_received','payment_made') NOT NULL,
  `zoho_transaction_id` varchar(50) NOT NULL,
  `transaction_number` varchar(100) DEFAULT NULL,
  `transaction_date` date DEFAULT NULL,
  `contact_name` varchar(255) DEFAULT NULL,
  `amount` decimal(14,2) DEFAULT 0.00,
  `status` varchar(50) DEFAULT NULL,
  `zoho_location_id` varchar(50) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_daily` (`daily_transaction_id`),
  KEY `idx_type` (`transaction_type`),
  KEY `idx_date` (`transaction_date`),
  KEY `idx_zdtd_transaction` (`zoho_transaction_id`),
  KEY `idx_zdtd_zoho_loc` (`zoho_location_id`),
  CONSTRAINT `zoho_daily_transaction_details_ibfk_1` FOREIGN KEY (`daily_transaction_id`) REFERENCES `zoho_daily_transactions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `zoho_daily_transactions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `zoho_daily_transactions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `transaction_date` date NOT NULL,
  `zoho_location_id` varchar(50) DEFAULT NULL,
  `location_name` varchar(255) DEFAULT NULL,
  `invoice_count` int(11) DEFAULT 0,
  `invoice_amount` decimal(14,2) DEFAULT 0.00,
  `bill_count` int(11) DEFAULT 0,
  `bill_amount` decimal(14,2) DEFAULT 0.00,
  `sales_order_count` int(11) DEFAULT 0,
  `sales_order_amount` decimal(14,2) DEFAULT 0.00,
  `purchase_order_count` int(11) DEFAULT 0,
  `purchase_order_amount` decimal(14,2) DEFAULT 0.00,
  `payment_received_count` int(11) DEFAULT 0,
  `payment_received_amount` decimal(14,2) DEFAULT 0.00,
  `payment_made_count` int(11) DEFAULT 0,
  `payment_made_amount` decimal(14,2) DEFAULT 0.00,
  `generated_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_date_location` (`transaction_date`,`zoho_location_id`),
  KEY `idx_date` (`transaction_date`),
  KEY `idx_location` (`zoho_location_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `zoho_expenses`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `zoho_expenses` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `expense_id` varchar(100) NOT NULL,
  `account_name` varchar(200) DEFAULT NULL,
  `paid_through_account_name` varchar(200) DEFAULT NULL,
  `vendor_name` varchar(200) DEFAULT NULL,
  `date` date DEFAULT NULL,
  `total` decimal(12,2) DEFAULT 0.00,
  `tax_amount` decimal(10,2) DEFAULT 0.00,
  `description` text DEFAULT NULL,
  `status` varchar(50) DEFAULT NULL,
  `currency_code` varchar(10) DEFAULT 'INR',
  `reference_number` varchar(100) DEFAULT NULL,
  `synced_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `expense_id` (`expense_id`),
  KEY `idx_date` (`date`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `zoho_financial_reports`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `zoho_financial_reports` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `report_type` varchar(50) NOT NULL COMMENT 'profit_loss, balance_sheet, cash_flow, receivables_summary, aging_summary, sales_by_customer, sales_by_item',
  `report_period` varchar(30) NOT NULL COMMENT 'monthly/quarterly/yearly + date range',
  `from_date` date DEFAULT NULL,
  `to_date` date DEFAULT NULL,
  `report_data` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`report_data`)),
  `summary` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT 'Key totals for quick dashboard access' CHECK (json_valid(`summary`)),
  `generated_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_report_type` (`report_type`),
  KEY `idx_period` (`report_period`),
  KEY `idx_dates` (`from_date`,`to_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `zoho_invoices`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `zoho_invoices` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `zoho_invoice_id` varchar(50) NOT NULL,
  `zoho_customer_id` varchar(50) DEFAULT NULL,
  `local_customer_id` int(11) DEFAULT NULL,
  `invoice_number` varchar(50) DEFAULT NULL,
  `reference_number` varchar(100) DEFAULT NULL,
  `invoice_date` date DEFAULT NULL,
  `due_date` date DEFAULT NULL,
  `currency_code` varchar(10) DEFAULT 'INR',
  `sub_total` decimal(12,2) DEFAULT 0.00,
  `tax_total` decimal(12,2) DEFAULT 0.00,
  `total` decimal(12,2) DEFAULT 0.00,
  `balance` decimal(12,2) DEFAULT 0.00,
  `status` enum('draft','sent','overdue','paid','partially_paid','void') DEFAULT 'draft',
  `customer_name` varchar(255) DEFAULT NULL,
  `zoho_location_id` varchar(50) DEFAULT NULL,
  `zoho_salesperson_id` varchar(50) DEFAULT NULL,
  `zoho_salesperson_name` varchar(255) DEFAULT NULL,
  `local_branch_id` int(11) DEFAULT NULL,
  `line_items` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`line_items`)),
  `notes` text DEFAULT NULL,
  `terms` text DEFAULT NULL,
  `created_time` datetime DEFAULT NULL,
  `last_modified_time` datetime DEFAULT NULL,
  `last_synced_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `invoice_id` varchar(50) GENERATED ALWAYS AS (`zoho_invoice_id`) VIRTUAL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_zoho_invoice` (`zoho_invoice_id`),
  KEY `idx_zoho_customer` (`zoho_customer_id`),
  KEY `idx_local_customer` (`local_customer_id`),
  KEY `idx_status` (`status`),
  KEY `idx_invoice_date` (`invoice_date`),
  KEY `idx_due_date` (`due_date`),
  KEY `idx_local_branch_id` (`local_branch_id`),
  KEY `idx_salesperson` (`zoho_salesperson_id`),
  KEY `idx_zinv_branch_date` (`local_branch_id`,`invoice_date`),
  CONSTRAINT `zoho_invoices_ibfk_1` FOREIGN KEY (`local_customer_id`) REFERENCES `customers` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `zoho_invoices_archive`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `zoho_invoices_archive` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `zoho_invoice_id` varchar(50) NOT NULL,
  `zoho_customer_id` varchar(50) DEFAULT NULL,
  `local_customer_id` int(11) DEFAULT NULL,
  `invoice_number` varchar(50) DEFAULT NULL,
  `reference_number` varchar(100) DEFAULT NULL,
  `invoice_date` date DEFAULT NULL,
  `due_date` date DEFAULT NULL,
  `currency_code` varchar(10) DEFAULT 'INR',
  `sub_total` decimal(12,2) DEFAULT 0.00,
  `tax_total` decimal(12,2) DEFAULT 0.00,
  `total` decimal(12,2) DEFAULT 0.00,
  `balance` decimal(12,2) DEFAULT 0.00,
  `status` enum('draft','sent','overdue','paid','partially_paid','void') DEFAULT 'draft',
  `customer_name` varchar(255) DEFAULT NULL,
  `line_items` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`line_items`)),
  `notes` text DEFAULT NULL,
  `terms` text DEFAULT NULL,
  `created_time` datetime DEFAULT NULL,
  `last_modified_time` datetime DEFAULT NULL,
  `last_synced_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_zoho_invoice` (`zoho_invoice_id`),
  KEY `idx_zoho_customer` (`zoho_customer_id`),
  KEY `idx_local_customer` (`local_customer_id`),
  KEY `idx_status` (`status`),
  KEY `idx_invoice_date` (`invoice_date`),
  KEY `idx_due_date` (`due_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `zoho_items_map`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `zoho_items_map` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `local_product_id` int(11) DEFAULT NULL,
  `zoho_item_id` varchar(50) NOT NULL,
  `zoho_item_name` varchar(255) DEFAULT NULL,
  `zoho_sku` varchar(100) DEFAULT NULL,
  `zoho_rate` decimal(12,2) DEFAULT NULL,
  `zoho_unit` varchar(20) DEFAULT NULL,
  `zoho_tax_id` varchar(50) DEFAULT NULL,
  `zoho_description` text DEFAULT NULL,
  `zoho_purchase_rate` decimal(12,2) DEFAULT NULL,
  `zoho_label_rate` decimal(12,2) DEFAULT NULL,
  `zoho_tax_name` varchar(100) DEFAULT NULL,
  `zoho_tax_percentage` decimal(5,2) DEFAULT NULL,
  `zoho_hsn_or_sac` varchar(20) DEFAULT NULL,
  `zoho_brand` varchar(100) DEFAULT NULL,
  `preferred_vendor_id` int(11) DEFAULT NULL,
  `last_purchase_rate` decimal(14,2) DEFAULT NULL,
  `vendor_pushed_at` datetime DEFAULT NULL,
  `zoho_manufacturer` varchar(100) DEFAULT NULL,
  `zoho_reorder_level` decimal(12,2) DEFAULT NULL,
  `zoho_stock_on_hand` decimal(12,2) DEFAULT NULL,
  `zoho_category_name` varchar(100) DEFAULT NULL,
  `image_url` varchar(500) DEFAULT NULL,
  `zoho_upc` varchar(50) DEFAULT NULL,
  `zoho_ean` varchar(50) DEFAULT NULL,
  `zoho_isbn` varchar(50) DEFAULT NULL,
  `zoho_part_number` varchar(50) DEFAULT NULL,
  `zoho_cf_product_name` varchar(255) DEFAULT NULL,
  `zoho_cf_dpl` varchar(255) DEFAULT NULL,
  `zoho_status` varchar(20) DEFAULT 'active',
  `last_synced_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `dpl_updated_at` timestamp NULL DEFAULT NULL,
  `dpl_disposition` varchar(16) NOT NULL DEFAULT 'pending',
  `dpl_disposition_at` datetime DEFAULT NULL,
  `dpl_disposition_by` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_zoho_item` (`zoho_item_id`),
  KEY `idx_local_product` (`local_product_id`),
  KEY `idx_zim_tax` (`zoho_tax_id`),
  KEY `idx_preferred_vendor` (`preferred_vendor_id`),
  CONSTRAINT `zoho_items_map_ibfk_1` FOREIGN KEY (`local_product_id`) REFERENCES `products` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `zoho_location_stock`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `zoho_location_stock` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `zoho_item_id` varchar(50) NOT NULL,
  `zoho_location_id` varchar(50) NOT NULL,
  `item_name` varchar(255) DEFAULT NULL,
  `sku` varchar(100) DEFAULT NULL,
  `stock_on_hand` decimal(12,2) DEFAULT 0.00,
  `available_stock` decimal(12,2) DEFAULT 0.00,
  `committed_stock` decimal(12,2) DEFAULT 0.00,
  `available_for_sale` decimal(12,2) DEFAULT 0.00,
  `last_synced_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_item_location` (`zoho_item_id`,`zoho_location_id`),
  KEY `idx_location` (`zoho_location_id`),
  KEY `idx_item` (`zoho_item_id`),
  KEY `idx_low_stock` (`stock_on_hand`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `zoho_locations_map`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `zoho_locations_map` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `zoho_location_id` varchar(50) NOT NULL,
  `zoho_location_name` varchar(255) DEFAULT NULL,
  `local_branch_id` int(11) DEFAULT NULL,
  `is_primary` tinyint(1) DEFAULT 0,
  `is_active` tinyint(1) DEFAULT 1,
  `address` text DEFAULT NULL,
  `last_synced_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_zoho_location` (`zoho_location_id`),
  KEY `idx_branch` (`local_branch_id`),
  CONSTRAINT `zoho_locations_map_ibfk_1` FOREIGN KEY (`local_branch_id`) REFERENCES `branches` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `zoho_oauth_tokens`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `zoho_oauth_tokens` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `organization_id` varchar(50) NOT NULL,
  `access_token` text NOT NULL,
  `refresh_token` text NOT NULL,
  `token_type` varchar(20) DEFAULT 'Zoho-oauthtoken',
  `api_domain` varchar(100) DEFAULT 'https://www.zohoapis.in',
  `expires_at` datetime NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_org` (`organization_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `zoho_payments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `zoho_payments` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `zoho_payment_id` varchar(50) NOT NULL,
  `zoho_invoice_id` varchar(50) DEFAULT NULL,
  `zoho_customer_id` varchar(50) DEFAULT NULL,
  `local_customer_id` int(11) DEFAULT NULL,
  `payment_number` varchar(50) DEFAULT NULL,
  `payment_date` date DEFAULT NULL,
  `amount` decimal(12,2) NOT NULL,
  `unused_amount` decimal(12,2) DEFAULT 0.00,
  `payment_mode` varchar(50) DEFAULT NULL,
  `reference_number` varchar(100) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `customer_name` varchar(255) DEFAULT NULL,
  `bank_charges` decimal(12,2) DEFAULT 0.00,
  `last_synced_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_zoho_payment` (`zoho_payment_id`),
  KEY `idx_zoho_invoice` (`zoho_invoice_id`),
  KEY `idx_payment_date` (`payment_date`),
  KEY `local_customer_id` (`local_customer_id`),
  KEY `idx_zp_customer` (`zoho_customer_id`),
  CONSTRAINT `zoho_payments_ibfk_1` FOREIGN KEY (`local_customer_id`) REFERENCES `customers` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `zoho_payments_archive`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `zoho_payments_archive` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `zoho_payment_id` varchar(50) NOT NULL,
  `zoho_invoice_id` varchar(50) DEFAULT NULL,
  `zoho_customer_id` varchar(50) DEFAULT NULL,
  `local_customer_id` int(11) DEFAULT NULL,
  `payment_number` varchar(50) DEFAULT NULL,
  `payment_date` date DEFAULT NULL,
  `amount` decimal(12,2) NOT NULL,
  `unused_amount` decimal(12,2) DEFAULT 0.00,
  `payment_mode` varchar(50) DEFAULT NULL,
  `reference_number` varchar(100) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `customer_name` varchar(255) DEFAULT NULL,
  `bank_charges` decimal(12,2) DEFAULT 0.00,
  `last_synced_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_zoho_payment` (`zoho_payment_id`),
  KEY `idx_zoho_invoice` (`zoho_invoice_id`),
  KEY `idx_payment_date` (`payment_date`),
  KEY `local_customer_id` (`local_customer_id`),
  KEY `idx_zp_customer` (`zoho_customer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `zoho_purchase_suggestions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `zoho_purchase_suggestions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `batch_id` varchar(50) NOT NULL,
  `zoho_item_id` varchar(50) NOT NULL,
  `item_name` varchar(255) DEFAULT NULL,
  `sku` varchar(100) DEFAULT NULL,
  `category_name` varchar(100) DEFAULT NULL,
  `zoho_location_id` varchar(50) DEFAULT NULL,
  `branch_name` varchar(100) DEFAULT NULL,
  `global_reorder_level` decimal(12,2) DEFAULT NULL,
  `branch_reorder_threshold` decimal(12,2) DEFAULT NULL,
  `current_stock` decimal(12,2) DEFAULT NULL,
  `suggested_qty` decimal(12,2) DEFAULT NULL,
  `priority` enum('HIGH','MEDIUM','LOW') DEFAULT 'LOW',
  `total_sales_90d` decimal(12,2) DEFAULT 0.00,
  `daily_avg_sales` decimal(12,4) DEFAULT 0.0000,
  `used_category_default` tinyint(1) DEFAULT 0,
  `status` enum('pending','ordered','dismissed') DEFAULT 'pending',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_batch` (`batch_id`),
  KEY `idx_item` (`zoho_item_id`),
  KEY `idx_location` (`zoho_location_id`),
  KEY `idx_priority` (`priority`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `zoho_reorder_alerts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `zoho_reorder_alerts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `zoho_item_id` varchar(50) NOT NULL,
  `zoho_location_id` varchar(50) NOT NULL,
  `reorder_config_id` int(11) DEFAULT NULL,
  `item_name` varchar(255) DEFAULT NULL,
  `location_name` varchar(255) DEFAULT NULL,
  `current_stock` decimal(12,2) DEFAULT 0.00,
  `reorder_level` decimal(12,2) DEFAULT 0.00,
  `reorder_quantity` decimal(12,2) DEFAULT 0.00,
  `severity` enum('critical','high','medium','low') DEFAULT 'low',
  `status` enum('active','acknowledged','resolved','auto_resolved') DEFAULT 'active',
  `acknowledged_by` int(11) DEFAULT NULL,
  `acknowledged_at` datetime DEFAULT NULL,
  `resolved_by` int(11) DEFAULT NULL,
  `resolved_at` datetime DEFAULT NULL,
  `resolution_notes` text DEFAULT NULL,
  `whatsapp_sent` tinyint(1) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_item_loc` (`zoho_item_id`,`zoho_location_id`),
  KEY `idx_item` (`zoho_item_id`),
  KEY `idx_location` (`zoho_location_id`),
  KEY `idx_severity` (`severity`),
  KEY `idx_status` (`status`),
  KEY `idx_active_alerts` (`status`,`severity`),
  KEY `reorder_config_id` (`reorder_config_id`),
  KEY `acknowledged_by` (`acknowledged_by`),
  KEY `resolved_by` (`resolved_by`),
  CONSTRAINT `zoho_reorder_alerts_ibfk_1` FOREIGN KEY (`reorder_config_id`) REFERENCES `zoho_reorder_config` (`id`) ON DELETE SET NULL,
  CONSTRAINT `zoho_reorder_alerts_ibfk_2` FOREIGN KEY (`acknowledged_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `zoho_reorder_alerts_ibfk_3` FOREIGN KEY (`resolved_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `zoho_reorder_config`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `zoho_reorder_config` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `zoho_item_id` varchar(50) NOT NULL,
  `zoho_location_id` varchar(50) NOT NULL,
  `item_name` varchar(255) DEFAULT NULL,
  `location_name` varchar(255) DEFAULT NULL,
  `reorder_level` decimal(12,2) NOT NULL DEFAULT 0.00,
  `reorder_quantity` decimal(12,2) DEFAULT 0.00,
  `max_stock` decimal(12,2) DEFAULT 0.00,
  `is_active` tinyint(1) DEFAULT 1,
  `alert_frequency` enum('immediate','daily','weekly') DEFAULT 'daily',
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `source` enum('manual','auto') NOT NULL DEFAULT 'manual',
  `avg_daily_sales` decimal(10,3) DEFAULT NULL,
  `computed_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_item_location` (`zoho_item_id`,`zoho_location_id`),
  KEY `idx_item` (`zoho_item_id`),
  KEY `idx_location` (`zoho_location_id`),
  KEY `idx_active` (`is_active`),
  KEY `created_by` (`created_by`),
  CONSTRAINT `zoho_reorder_config_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `zoho_stock_history`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `zoho_stock_history` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `zoho_item_id` varchar(50) NOT NULL,
  `zoho_location_id` varchar(50) NOT NULL,
  `item_name` varchar(255) DEFAULT NULL,
  `previous_stock` decimal(12,2) DEFAULT 0.00,
  `new_stock` decimal(12,2) DEFAULT 0.00,
  `change_amount` decimal(12,2) DEFAULT 0.00,
  `source` varchar(50) DEFAULT NULL COMMENT 'sync, adjustment, transfer, sale, purchase',
  `reference_id` varchar(100) DEFAULT NULL COMMENT 'Invoice/PO/SO ID',
  `reference_type` varchar(50) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `recorded_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_item` (`zoho_item_id`),
  KEY `idx_location` (`zoho_location_id`),
  KEY `idx_recorded` (`recorded_at`),
  KEY `idx_item_location` (`zoho_item_id`,`zoho_location_id`),
  KEY `idx_zsh_reference` (`reference_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `zoho_stock_history_archive`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `zoho_stock_history_archive` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `zoho_item_id` varchar(50) NOT NULL,
  `zoho_location_id` varchar(50) NOT NULL,
  `item_name` varchar(255) DEFAULT NULL,
  `previous_stock` decimal(12,2) DEFAULT 0.00,
  `new_stock` decimal(12,2) DEFAULT 0.00,
  `change_amount` decimal(12,2) DEFAULT 0.00,
  `source` varchar(50) DEFAULT NULL COMMENT 'sync, adjustment, transfer, sale, purchase',
  `reference_id` varchar(100) DEFAULT NULL COMMENT 'Invoice/PO/SO ID',
  `reference_type` varchar(50) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `recorded_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_item` (`zoho_item_id`),
  KEY `idx_location` (`zoho_location_id`),
  KEY `idx_recorded` (`recorded_at`),
  KEY `idx_item_location` (`zoho_item_id`,`zoho_location_id`),
  KEY `idx_zsh_reference` (`reference_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `zoho_sync_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `zoho_sync_log` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `sync_type` enum('invoices','payments','customers','items','reports','full','quick','locations','stock','transactions','reorder','reorder_compute') NOT NULL,
  `direction` enum('zoho_to_local','local_to_zoho','bidirectional') DEFAULT 'zoho_to_local',
  `status` enum('started','in_progress','completed','failed') DEFAULT 'started',
  `records_total` int(11) DEFAULT 0,
  `records_synced` int(11) DEFAULT 0,
  `records_failed` int(11) DEFAULT 0,
  `error_message` text DEFAULT NULL,
  `triggered_by` int(11) DEFAULT NULL COMMENT 'user_id who triggered, NULL for auto',
  `started_at` timestamp NULL DEFAULT current_timestamp(),
  `completed_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_sync_type` (`sync_type`),
  KEY `idx_status` (`status`),
  KEY `idx_started` (`started_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

