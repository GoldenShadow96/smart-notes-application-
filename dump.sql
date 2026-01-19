-- --------------------------------------------------------
-- Host:                         127.0.0.1
-- Wersja serwera:               12.1.2-MariaDB - MariaDB Server
-- Serwer OS:                    Win64
-- HeidiSQL Wersja:              12.11.0.7065
-- --------------------------------------------------------

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET NAMES utf8 */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;


-- Zrzut struktury bazy danych notes_app
CREATE DATABASE IF NOT EXISTS `notes_app` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci */;
USE `notes_app`;

-- Zrzut struktury tabela notes_app.bot_clients
CREATE TABLE IF NOT EXISTS `bot_clients` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(64) NOT NULL,
  `api_key_hash` binary(32) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_bot_clients_name` (`name`),
  UNIQUE KEY `uq_bot_clients_api_key_hash` (`api_key_hash`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Eksport danych został odznaczony.

-- Zrzut struktury tabela notes_app.discord_links
CREATE TABLE IF NOT EXISTS `discord_links` (
  `discord_user_id` bigint(20) unsigned NOT NULL,
  `user_id` int(11) NOT NULL,
  `linked_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`discord_user_id`),
  UNIQUE KEY `uq_discord_links_user_id` (`user_id`),
  CONSTRAINT `fk_discord_links_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Eksport danych został odznaczony.

-- Zrzut struktury tabela notes_app.discord_link_codes
CREATE TABLE IF NOT EXISTS `discord_link_codes` (
  `code` char(32) NOT NULL,
  `user_id` int(11) NOT NULL,
  `expires_at` datetime NOT NULL,
  `used_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`code`),
  KEY `idx_discord_link_codes_user_id` (`user_id`),
  KEY `idx_discord_link_codes_expires` (`expires_at`),
  CONSTRAINT `fk_discord_link_codes_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Eksport danych został odznaczony.

-- Zrzut struktury tabela notes_app.graph_layouts
CREATE TABLE IF NOT EXISTS `graph_layouts` (
  `user_id` int(11) NOT NULL,
  `layout_key` varchar(128) NOT NULL,
  `layout_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`layout_json`)),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`user_id`,`layout_key`),
  CONSTRAINT `fk_graph_layout_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Eksport danych został odznaczony.

-- Zrzut struktury tabela notes_app.notes
CREATE TABLE IF NOT EXISTS `notes` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `title` varchar(255) NOT NULL,
  `is_public` tinyint(1) NOT NULL DEFAULT 0,
  `content_iv` varbinary(12) NOT NULL,
  `content_tag` varbinary(16) NOT NULL,
  `content_ct` mediumblob NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_notes_user_updated` (`user_id`,`updated_at`),
  KEY `idx_notes_user_title` (`user_id`,`title`),
  KEY `idx_notes_public_updated` (`is_public`,`updated_at`),
  CONSTRAINT `fk_notes_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=202 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Eksport danych został odznaczony.

-- Zrzut struktury tabela notes_app.note_links
CREATE TABLE IF NOT EXISTS `note_links` (
  `from_note_id` int(11) NOT NULL,
  `to_note_id` int(11) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`from_note_id`,`to_note_id`),
  KEY `idx_to_note` (`to_note_id`),
  KEY `idx_from_note` (`from_note_id`),
  CONSTRAINT `fk_links_from` FOREIGN KEY (`from_note_id`) REFERENCES `notes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_links_to` FOREIGN KEY (`to_note_id`) REFERENCES `notes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Eksport danych został odznaczony.

-- Zrzut struktury tabela notes_app.note_orders
CREATE TABLE IF NOT EXISTS `note_orders` (
  `user_id` int(11) NOT NULL,
  `note_id` int(11) NOT NULL,
  `sort_index` int(11) NOT NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`user_id`,`note_id`),
  UNIQUE KEY `uq_note_orders_user_sort` (`user_id`,`sort_index`),
  KEY `idx_note_orders_note` (`note_id`),
  CONSTRAINT `fk_note_orders_note` FOREIGN KEY (`note_id`) REFERENCES `notes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_note_orders_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Eksport danych został odznaczony.

-- Zrzut struktury tabela notes_app.users
CREATE TABLE IF NOT EXISTS `users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `username` varchar(64) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `key_iv` varbinary(12) NOT NULL,
  `key_tag` varbinary(16) NOT NULL,
  `key_ct` varbinary(128) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_username` (`username`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Eksport danych został odznaczony.

/*!40103 SET TIME_ZONE=IFNULL(@OLD_TIME_ZONE, 'system') */;
/*!40101 SET SQL_MODE=IFNULL(@OLD_SQL_MODE, '') */;
/*!40014 SET FOREIGN_KEY_CHECKS=IFNULL(@OLD_FOREIGN_KEY_CHECKS, 1) */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40111 SET SQL_NOTES=IFNULL(@OLD_SQL_NOTES, 1) */;
