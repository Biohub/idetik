---
title: Examples
sidebar: false
aside: false
---

<script setup>
import { onMounted } from 'vue'
import { withBase } from 'vitepress'
import { data as examples } from '../../.vitepress/theme/components/showcase/examples.data.js'

const first = withBase(`/showcase/${examples[0].id}.html`)
onMounted(() => location.replace(first))
</script>

Redirecting to the <a :href="first">first example</a>…
