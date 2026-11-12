---
title: Examples
sidebar: false
aside: false
---

<script setup>
import { onMounted } from 'vue'
import { withBase } from 'vitepress'
import { examples } from '../../examples/examples.ts'

const first = withBase(`/examples/${examples[0].id}.html`)
onMounted(() => location.replace(first))
</script>

Redirecting to the <a :href="first">first example</a>…
